class_name MarketStore
extends Node
## Native state owner and revision protocol from src/game/store.ts.
signal changed
signal message_changed(message: String, revision: int)
const Game = preload("res://game/engine.gd")
const Snapshot = preload("res://game/persistence/snapshot.gd")
const Recovery = preload("res://game/persistence/recovery_storage.gd")
const Identity = preload("res://game/persistence/client_identity.gd")
const Api = preload("res://game/persistence/market_api.gd")
const MAX_PENDING_INTERACTIONS = 64
var game: Variant = null
var save_revision: int = 0
var save_status: String = "idle"
var message: String = ""
var message_revision: int = 0
var pending_events: Array = []
var last_save_confirmed_at: int = 0
var pending_player_distance_meters: float = 0
var pending_interactions: Array = []
var save_in_flight: bool = false
var pending_save_attempt: Variant = null
var _session_generation := 0
var qa_simulation_frozen: bool = false
var recovery: Recovery
var api: Api

func _ready() -> void:
	if recovery == null:
		recovery = Recovery.new()
		add_child(recovery)
	if api == null:
		api = Api.new()
		add_child(api)

func reset_session() -> void:
	# The browser original reloads on logout. In a persistent native application
	# invalidate every awaited operation before another account can load.
	_session_generation += 1
	game = null
	save_revision = 0
	save_status = "idle"
	save_in_flight = false
	pending_save_attempt = null
	pending_events = []
	pending_interactions = []
	pending_player_distance_meters = 0
	recovery.clear_recovery_snapshot()
	changed.emit()

func _say(value: String) -> void:
	message = value
	message_revision += 1
	message_changed.emit(message, message_revision)

func _snapshot(state: Dictionary, revision: int, events: Array) -> Dictionary:
	return {"state": state, "saveRevision": revision, "pendingEvents": events, "pendingSave": pending_save_attempt}

func _confirm_time() -> void:
	last_save_confirmed_at = int(Time.get_unix_time_from_system() * 1000)

func load_game() -> void:
	if game != null or save_status == "loading": return
	var generation := _session_generation
	pending_player_distance_meters = 0
	pending_interactions = []
	game = null
	save_revision = 0
	save_status = "loading"
	message = ""
	pending_events = []
	changed.emit()
	var response := await api.request_json("/api/game/save")
	if generation != _session_generation: return
	if not response.ok or not response.data.get("state") is Dictionary:
		await recovery.import_browser_recovery()
		if generation != _session_generation: return
		_load_offline()
		return
	if response.data.get("recoveryScope") is String: recovery.set_recovery_scope(response.data.recoveryScope)
	await recovery.import_browser_recovery()
	if generation != _session_generation: return
	accept_server_load(response.data, recovery.read_recovery_snapshot())

func _scoped_recovery(scope: String) -> Variant:
	recovery.set_recovery_scope(scope)
	return recovery.read_recovery_snapshot()

func accept_server_load(payload: Dictionary, local: Variant) -> void:
	var server_state := Game.normalize_game_state(payload.state)
	if local != null and not JS.get_or(local, "pendingEvents", []).is_empty() and local.state.get("currentFranchiseId"):
		local.pendingEvents = Snapshot.restore_pending_event_origins(local.pendingEvents, local.state.currentFranchiseId)
	pending_save_attempt = local.get("pendingSave") if local != null else null
	if local != null and pending_save_attempt != null:
		var attempted_ids: Array = pending_save_attempt.events.map(func(event): return event.eventId)
		var applied: bool = payload.get("lastOperationId") == pending_save_attempt.operationId or (payload.saveRevision >= pending_save_attempt.expectedRevision + 1 and attempted_ids.all(func(id): return id in server_state.processedEventIds))
		if applied:
			var local_state := Game.normalize_game_state(local.state)
			var remaining: Array = JS.get_or(local, "pendingEvents", []).filter(func(event): return event.get("eventId") not in attempted_ids)
			var newer: bool = local_state.revision > pending_save_attempt.state.revision
			pending_save_attempt = null
			game = local_state if newer else server_state
			save_revision = payload.saveRevision
			save_status = "dirty" if newer or not remaining.is_empty() else "saved"
			pending_events = remaining
			_confirm_time()
			_say("Confirmé un guardado cuya respuesta se había perdido")
		elif payload.saveRevision == pending_save_attempt.expectedRevision:
			game = Game.normalize_game_state(local.state)
			save_revision = local.saveRevision
			save_status = "dirty"
			pending_events = JS.get_or(local, "pendingEvents", [])
			_say("Recuperé un guardado local pendiente")
		else:
			game = Game.normalize_game_state(local.state)
			save_revision = local.saveRevision
			save_status = "conflict"
			pending_events = JS.get_or(local, "pendingEvents", [])
			_say("Detecté progreso distinto en otro dispositivo; conservé esta copia sin sobrescribirla")
		recovery.queue_recovery_snapshot(_snapshot(game, save_revision, pending_events))
		changed.emit()
		return
	if local != null and local.saveRevision == payload.saveRevision:
		var selected := Snapshot.choose_recovery({"state": server_state, "saveRevision": payload.saveRevision, "pendingEvents": []}, {"state": Game.normalize_game_state(local.state), "saveRevision": local.saveRevision, "pendingEvents": JS.get_or(local, "pendingEvents", [])})
		if selected.source == "local":
			game = selected.envelope.state
			save_revision = payload.saveRevision
			save_status = "dirty"
			pending_events = selected.envelope.pendingEvents
			recovery.queue_recovery_snapshot(_snapshot(game, save_revision, pending_events))
			_confirm_time()
			_say("Recuperé cambios locales pendientes")
			changed.emit()
			return
	pending_save_attempt = null
	game = server_state
	save_revision = payload.saveRevision
	save_status = "saved"
	recovery.queue_recovery_snapshot(_snapshot(game, save_revision, []))
	_confirm_time()
	_say("Progreso sincronizado")
	changed.emit()

func _load_offline() -> void:
	var local: Variant = recovery.read_recovery_snapshot()
	pending_save_attempt = local.get("pendingSave") if local != null else null
	if local != null:
		var events: Array = JS.get_or(local, "pendingEvents", [])
		if not events.is_empty() and local.state.get("currentFranchiseId"): events = Snapshot.restore_pending_event_origins(events, local.state.currentFranchiseId)
		game = Game.normalize_game_state(local.state)
		save_revision = local.saveRevision
		save_status = "offline"
		pending_events = events
		_say("Modo sin conexión: progreso protegido localmente")
	else:
		save_status = "error"
		_say("No se pudo cargar la partida")
	changed.emit()

func dispatch(action: Dictionary) -> Variant:
	if game == null: return null
	var result := Game.apply_game_action(game, action)
	if result.ok:
		pending_events = pending_events + result.events
		game = result.state
		save_status = "saving" if save_in_flight else "dirty"
		recovery.queue_recovery_snapshot(_snapshot(game, save_revision, pending_events))
	_say(result.message)
	changed.emit()
	return result

func record_player_distance(meters: float) -> void:
	var safe: float = clampf(meters, 0, 100) if is_finite(meters) else 0
	pending_player_distance_meters = minf(100, pending_player_distance_meters + safe)

func queue_interaction(action: Dictionary) -> void:
	if pending_interactions.size() < MAX_PENDING_INTERACTIONS: pending_interactions.append(action)

func simulate(minutes: float = 10) -> void:
	if qa_simulation_frozen or game == null: return
	var result := Game.advance_simulation(game, minutes)
	pending_events = pending_events + result.events
	game = result.state
	save_status = "saving" if save_in_flight else "dirty"
	recovery.queue_recovery_snapshot(_snapshot(game, save_revision, pending_events))
	changed.emit()

func tick_world(delta_ms: float = 250) -> void:
	if qa_simulation_frozen or game == null: return
	var franchise := Game.Progression.current_franchise(game)
	NavMeshService.ensure_store_navigation(franchise.structureRevision, franchise.unlockedAreas)
	var distance := pending_player_distance_meters
	var interactions := pending_interactions
	var result := Game.advance_world(game, delta_ms, Callable(NavMeshService, "store_pathfinder"), {"playerDistanceMeters": distance, "interactions": interactions})
	pending_player_distance_meters = maxf(0, pending_player_distance_meters - distance)
	pending_interactions = pending_interactions.slice(interactions.size())
	pending_events = pending_events + result.events
	game = result.state
	save_status = "saving" if save_in_flight else "dirty"
	recovery.queue_recovery_snapshot(_snapshot(game, save_revision, pending_events))
	if not interactions.is_empty(): _say(result.message)
	changed.emit()

func begin_save_attempt() -> Variant:
	if game == null or save_in_flight or (save_status == "saved" and pending_events.is_empty()): return null
	save_in_flight = true
	save_status = "saving"
	var device := Identity.game_device_id()
	var reuse: bool = pending_save_attempt != null and pending_save_attempt.deviceId == device and pending_save_attempt.expectedRevision == save_revision
	if not reuse:
		pending_save_attempt = {"expectedRevision": save_revision, "operationId": JS.uuid(), "deviceId": device, "sessionId": Identity.game_session_id(), "state": Snapshot.create_snapshot(game), "events": pending_events.duplicate(true)}
	recovery.queue_recovery_snapshot(_snapshot(game, save_revision, pending_events))
	changed.emit()
	return pending_save_attempt

func save_game(keepalive: bool = false) -> void:
	var attempt: Variant = begin_save_attempt()
	if attempt == null: return
	# A reload can interrupt any save, not just an explicit unload keepalive.
	# Persist its retry identity before the server can advance the revision.
	recovery.flush_recovery_snapshot()
	var response := await api.request_json("/api/game/save", "PUT", attempt, {"x-market-release": Recovery.CAMPAIGN_RELEASE}, keepalive)
	finish_save_attempt(attempt, response)

func finish_save_attempt(attempt: Dictionary, response: Dictionary) -> void:
	if game == null or pending_save_attempt == null or pending_save_attempt.operationId != attempt.operationId: return
	var payload: Dictionary = response.data
	if response.status == 0:
		save_status = "offline"
		_say("Sin conexión: los cambios siguen protegidos en este dispositivo")
	elif response.status == 409:
		recovery.persist_recovery_snapshot(_snapshot(game, attempt.expectedRevision, pending_events))
		save_revision = attempt.expectedRevision
		save_status = "conflict"
		var same_device: bool = payload.get("conflict", {}).get("deviceId") == attempt.deviceId
		_say("Conflicto con %s; tu progreso local no fue sustituido" % ("otra pestaña de este dispositivo" if same_device else "otro dispositivo"))
	elif not response.ok:
		var retryable: bool = response.status == 429 or response.status >= 500
		if not retryable: pending_save_attempt = null
		var issue := ""
		if payload.get("issues") is Array and not payload.issues.is_empty():
			var first: Dictionary = payload.issues[0]
			var details: Array[String] = []
			if first.get("path") is Array and not first.path.is_empty(): details.append(".".join(first.path.map(func(part): return str(part))))
			if first.get("message"): details.append(first.message)
			issue = " (%s)" % ": ".join(details)
		save_status = "offline" if retryable else "error"
		_say("El servidor está ocupado; el guardado local se reintentará" if retryable else "El guardado fue rechazado: %s%s" % [payload.get("error", response.status), issue])
	else:
		var saved_ids: Array = attempt.events.map(func(event): return event.eventId)
		var remaining: Array = pending_events.filter(func(event): return event.get("eventId") not in saved_ids)
		var newer: bool = game != null and game.revision > attempt.state.revision
		game = game if newer else attempt.state
		pending_save_attempt = null
		save_revision = payload.saveRevision
		pending_events = remaining
		recovery.persist_recovery_snapshot(_snapshot(game, save_revision, pending_events))
		save_status = "dirty" if newer or not remaining.is_empty() else "saved"
		_confirm_time()
		_say("Guardado parcial; sincronizando cambios nuevos" if save_status == "dirty" else "Partida guardada")
	save_in_flight = false
	changed.emit()

func adopt_local_copy() -> void:
	if game == null or save_in_flight: return
	var generation := _session_generation
	var original: Dictionary = game
	save_in_flight = true
	save_status = "saving"
	changed.emit()
	var head := await api.request_json("/api/game/save")
	if generation != _session_generation: return
	if not head.ok:
		save_status = "conflict"
		_say("Sin conexión: no se pudo adoptar esta copia")
	else:
		var state := Snapshot.create_snapshot(Game.normalize_game_state(original))
		var attempt := {"expectedRevision": head.data.saveRevision, "operationId": JS.uuid(), "deviceId": Identity.game_device_id(), "sessionId": Identity.game_session_id(), "state": state, "events": [], "adoptLocal": true}
		var response := await api.request_json("/api/game/save", "PUT", attempt, {"x-market-release": Recovery.CAMPAIGN_RELEASE})
		if generation != _session_generation: return
		if not response.ok:
			save_status = "conflict"
			_say("Sin conexión: no se pudo adoptar esta copia" if response.status == 0 else "No se pudo adoptar esta copia: %s" % response.data.get("error", response.status))
		else:
			pending_save_attempt = null
			game = state
			save_revision = response.data.saveRevision
			save_status = "saved"
			pending_events = []
			recovery.persist_recovery_snapshot(_snapshot(game, save_revision, pending_events))
			_confirm_time()
			_say("Esta copia es ahora la partida oficial")
	save_in_flight = false
	changed.emit()

func restore_server_copy() -> void:
	if save_in_flight: return
	var generation := _session_generation
	save_in_flight = true
	save_status = "loading"
	changed.emit()
	var response := await api.request_json("/api/game/save")
	if generation != _session_generation: return
	if not response.ok:
		save_status = "conflict"
		_say("Sin conexión: no se pudo cargar la partida del servidor")
	else:
		game = Game.normalize_game_state(response.data.state)
		pending_save_attempt = null
		pending_interactions = []
		save_revision = response.data.saveRevision
		save_status = "saved"
		pending_events = []
		recovery.persist_recovery_snapshot(_snapshot(game, save_revision, pending_events))
		_confirm_time()
		_say("Partida del servidor restaurada")
	save_in_flight = false
	changed.emit()
