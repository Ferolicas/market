extends Node
const Store = preload("res://game/store.gd")
const Auth = preload("res://game/ui/auth_screen.gd")
const World = preload("res://game/scene/market_world.gd")
const Shell = preload("res://game/ui/game_shell.gd")
var store := Store.new()
var telemetry: MarketClientTelemetry
var screen: Control
var world: World
var canvas := CanvasLayer.new()
var world_elapsed := 0.0
var runtime_at_ms := -1
var sync_elapsed := 0.0
var player_name := ""
var audio: GameAudio
var unsubscribe_audio: Callable
var previous_payment: Variant = null
var browser_qa := false
var qa_navigation: NavMeshService
var qa_route_request := ""
var qa_route := {}
var curtain: MarketLoadingCurtain
var cast_warmup: MarketCastWarmup
var world_prepared := false
var browser_lifecycle_callback: JavaScriptObject

func _ready() -> void:
	if OS.has_feature("web") or OS.has_feature("ios"):
		get_window().content_scale_aspect = Window.CONTENT_SCALE_ASPECT_IGNORE
		get_window().content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
		get_window().size_changed.connect(_sync_display_size)
		_sync_display_size()
	if OS.has_feature("web") and OS.is_debug_build(): browser_qa = bool(JavaScriptBridge.eval("location.hostname === '127.0.0.1' && (new URLSearchParams(location.search).has('qa') || new URLSearchParams(location.hash.slice(1)).has('qa'))", true))
	add_child(store)
	if not OS.has_feature("web"): store.api.session_directory = "user://auth-sessions"
	store.changed.connect(_publish_browser_qa)
	add_child(canvas)
	var settings := AudioSettingsStore.shared()
	settings.hydrate()
	audio = GameAudio.new(settings.settings())
	add_child(audio)
	settings.changed.connect(audio.apply_settings)
	unsubscribe_audio = FeedbackBus.shared().subscribe(audio.play)
	# Only the web export needs a user gesture before audio can play; native
	# builds (iOS, desktop) can start the music the moment the app opens.
	if not OS.has_feature("web"): audio.unlock()
	if OS.has_feature("web"):
		browser_lifecycle_callback = JavaScriptBridge.create_callback(_browser_lifecycle)
		JavaScriptBridge.eval(FileAccess.get_file_as_string("res://game/persistence/browser_lifecycle.js"), true)
		JavaScriptBridge.get_interface("window").__marketInstallLifecycle(browser_lifecycle_callback)
	store.changed.connect(_payment_feedback)
	var configured := OS.get_environment("MARKET_API_URL")
	if not configured.is_empty(): store.api.base_url = configured
	if OS.has_feature("web"):
		store.api.base_url = str(JavaScriptBridge.eval("window.location.origin", true))
	get_tree().auto_accept_quit = false
	var is_reset := OS.has_feature("web") and bool(JavaScriptBridge.eval("new URLSearchParams(location.search).get('auth') === 'reset'", true))
	if is_reset:
		_show_auth()
		return
	if _has_saved_session():
		_show_loading()
		await _resume_session()
		if store.game == null:
			_show_auth()
	else:
		_show_auth()

func _has_saved_session() -> bool:
	if store.api.has_saved_session():
		return true
	if store.recovery.read_recovery_snapshot() != null:
		return true
	if OS.has_feature("web"):
		var remembered: Variant = JavaScriptBridge.eval("localStorage.getItem('mini-market-offline-player-v1')", true)
		if remembered is String and not remembered.is_empty():
			return true
	return false

func _show_loading() -> void:
	if screen != null:
		screen.queue_free()
		screen = null
	if not is_instance_valid(curtain):
		curtain = MarketLoadingCurtain.new()
		canvas.add_child(curtain)

func _resume_session() -> void:
	await store.recovery.import_browser_recovery()
	var session := await store.api.request_json("/api/auth/get-session")
	if session.ok and session.data is Dictionary and session.data.get("user") is Dictionary:
		_remember_player(session.data.user)
		await _load_game()
	elif session.status == 0 and store.recovery.read_recovery_snapshot() != null:
		if OS.has_feature("web"):
			var remembered: Variant = JavaScriptBridge.eval("localStorage.getItem('mini-market-offline-player-v1')", true)
			player_name = remembered if remembered is String else ""
		await _load_game()

func _sync_display_size() -> void:
	if OS.has_feature("ios"):
		var logical_size := MarketDisplayMetrics.logical_size(get_window().size, DisplayServer.screen_get_scale())
		if get_window().content_scale_size != logical_size: get_window().content_scale_size = logical_size
		return
	# DOM UI in the original uses CSS pixels, independent of the backing buffer.
	var dimensions: Array = JSON.parse_string(str(JavaScriptBridge.eval("JSON.stringify([innerWidth,innerHeight])", true)))
	var logical_size := Vector2i(maxi(1, int(dimensions[0])), maxi(1, int(dimensions[1])))
	if get_window().content_scale_size != logical_size: get_window().content_scale_size = logical_size

func _remember_player(user: Dictionary) -> void:
	player_name = user.get("name", "")
	if player_name.is_empty(): player_name = str(user.get("email", "")).get_slice("@", 0)
	if OS.has_feature("web"): JavaScriptBridge.eval("try { localStorage.setItem('mini-market-offline-player-v1', %s); } catch {}" % JSON.stringify(player_name), true)

func _show_auth() -> void:
	if is_instance_valid(telemetry):
		telemetry.free()
		telemetry = null
	if screen != null: screen.queue_free()
	if is_instance_valid(curtain): curtain.queue_free()
	world_prepared = false
	if world != null:
		world.queue_free()
		world = null
	var auth := Auth.new()
	auth.api = store.api
	if OS.has_feature("web") and bool(JavaScriptBridge.eval("new URLSearchParams(location.search).get('auth') === 'reset'", true)):
		auth.mode = "reset"
		auth.reset_token = str(JavaScriptBridge.eval("new URLSearchParams(location.search).get('token') || ''", true))
	auth.returned_home.connect(func():
		_show_loading()
		await _resume_session()
		if store.game == null:
			_show_auth())
	auth.authenticated.connect(func(user: Dictionary):
		_remember_player(user)
		await _load_game())
	canvas.add_child(auth)
	screen = auth
	_publish_browser_qa()

func _load_game() -> void:
	if not is_instance_valid(telemetry):
		telemetry = MarketClientTelemetry.new()
		telemetry.store = store
		add_child(telemetry)
	await store.load_game()
	if store.game == null: return
	if screen != null:
		screen.queue_free()
		screen = null
	world_prepared = false
	if not is_instance_valid(curtain) and store.game.tutorialStep > 0:
		curtain = MarketLoadingCurtain.new()
		canvas.add_child(curtain)
	if is_instance_valid(curtain): await get_tree().process_frame
	world = World.new()
	world.store = store
	add_child(world)
	telemetry.world = world
	if not world.load_timings_ms.is_empty():
		telemetry.report({"kind": "performance", "name": "startup-world-load", "payload": world.load_timings_ms})
	var shell := Shell.new()
	shell.store = store
	shell.world = world
	shell.player_name = player_name
	shell.sign_out_requested.connect(_sign_out)
	canvas.add_child(shell)
	screen = shell
	if is_instance_valid(curtain) and store.game.tutorialStep == 0:
		curtain.queue_free()
		curtain = null
	_publish_browser_qa()

func _process(delta: float) -> void:
	if browser_qa and screen is MarketAuthScreen: _publish_browser_qa()
	# The TS runtime uses performance.now(), not a capped physics/frame delta.
	var now := Time.get_ticks_msec()
	var elapsed := maxf(0, now - runtime_at_ms) / 1000.0 if runtime_at_ms >= 0 else delta
	runtime_at_ms = now
	if store.game == null or world == null or store.qa_simulation_frozen: return
	if store.game.tutorialStep > 0 and not world_prepared:
		world_prepared = true
		world.presentation_ready = false
		if not is_instance_valid(curtain):
			curtain = MarketLoadingCurtain.new()
			canvas.add_child(curtain)
		cast_warmup = MarketCastWarmup.new()
		world.add_child(cast_warmup)
		cast_warmup.prepare(world.player_body.position)
		world.rendering.scene_settled = false
		world.rendering.phase = "observing"
		world.rendering.warmup_ms = 0
		world.rendering.stable_frames = 0
	if is_instance_valid(curtain):
		world.driveable = false
		if world_prepared and world.rendering.scene_settled:
			curtain.queue_free()
			curtain = null
			cast_warmup.queue_free()
			world.presentation_ready = true
			if screen is Shell: screen.refresh()
	world_elapsed += elapsed
	sync_elapsed += elapsed
	if world_elapsed * 1000 >= Timing.WORLD_TICK_INTERVAL_MS:
		store.tick_world(minf(1000, world_elapsed * 1000))
		world_elapsed = 0
	if sync_elapsed >= 30:
		sync_elapsed = 0
		store.save_game()

func _sign_out() -> void:
	if OS.has_feature("web"): JavaScriptBridge.eval("try { localStorage.removeItem('mini-market-offline-player-v1'); navigator.serviceWorker?.controller?.postMessage({type:'CLEAR_PRIVATE_CACHE'}); } catch {}", true)
	player_name = ""
	store.reset_session()
	await store.api.sign_out()
	_show_auth()

func _browser_lifecycle(arguments: Array) -> void:
	var event: String = arguments[0]
	if event in ["hidden", "pagehide"]:
		set_process(false)
		if store.game != null: store.save_game(true)
		# The keepalive attempt must survive even if this page never gets its ACK.
		# Its operation ID is queued synchronously before save_game's first await.
		store.recovery.flush_recovery_snapshot()
		audio.set_hidden(true)
		if is_instance_valid(world):
			world.input.clear_all()
			world.joystick.end()
	elif event == "visible":
		runtime_at_ms = Time.get_ticks_msec()
		world_elapsed = 0
		sync_elapsed = 0
		set_process(true)
		audio.set_hidden(false)
	elif event == "online" and store.game != null:
		store.save_game()

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		store.recovery.flush_recovery_snapshot()
		NavMeshService.dispose_store_navigation()
		get_tree().quit()
	elif what == NOTIFICATION_APPLICATION_PAUSED:
		store.recovery.flush_recovery_snapshot()
		set_process(false)
	elif what == NOTIFICATION_APPLICATION_RESUMED:
		runtime_at_ms = Time.get_ticks_msec()
		world_elapsed = 0
		set_process(true)
		if store.game != null: store.save_game()

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton or event is InputEventScreenTouch or (event is InputEventKey and event.is_pressed()): audio.unlock()

func _payment_feedback() -> void:
	if store.game == null: return
	var franchise := EngineProgression.current_franchise(store.game)
	var snapshot := {"franchiseId": franchise.id, "customersToday": franchise.customersToday}
	if PaymentCue.new_customer_payments(previous_payment, snapshot) > 0: FeedbackBus.shared().emit("payment")
	previous_payment = snapshot

func _exit_tree() -> void:
	if OS.has_feature("web"): JavaScriptBridge.eval("window.__marketRemoveLifecycle?.()", true)
	NavMeshService.dispose_store_navigation()
	if qa_navigation != null: qa_navigation.dispose()
	if unsubscribe_audio.is_valid(): unsubscribe_audio.call()
	if audio != null: audio.close()

func _publish_browser_qa() -> void:
	if not browser_qa: return
	var state := {"view": "game" if world != null else "auth", "saveStatus": store.save_status, "saveRevision": store.save_revision, "message": store.message}
	if store.game != null:
		state.merge({"revision": store.game.revision, "tutorialStep": store.game.tutorialStep, "countryCode": store.game.countryCode, "simulationTimeMs": store.game.simulationTimeMs})
	if world != null and store.game != null:
		state.playerPosition = [world.player_body.position.x, world.player_body.position.z]
		state.movement = {"input": world.input.sample(), "workstation": world.workstation.snapshot(), "joystickOrigin": [world.joystick.origin.x, world.joystick.origin.y], "pointer": world.joystick.pointer_id, "collisions": []}
		for index in world.player_body.get_slide_collision_count():
			var collision := world.player_body.get_slide_collision(index)
			var body: Node3D = collision.get_collider()
			if not is_instance_valid(body): continue
			var shape := body.get_child(0) as CollisionShape3D
			state.movement.collisions.append({"normal": [collision.get_normal().x, collision.get_normal().y, collision.get_normal().z], "position": [collision.get_position().x, collision.get_position().z], "body": str(body.name), "shapePosition": [shape.global_position.x, shape.global_position.z] if shape != null else []})
		var franchise := EngineProgression.current_franchise(store.game)
		state.economy = {"carry": franchise.carry, "shelves": franchise.shelves, "customersToday": franchise.customersToday, "registerCashMinor": franchise.registerCashMinor, "balanceMinor": store.game.balanceMinor, "open": franchise.open, "customers": franchise.customers, "purchases": franchise.get("purchases")}
		state.selectedZones = world.director.selected_zone_ids()
		state.renderProfile = world.rendering.profile
		state.renderDpr = world.rendering.dpr
		state.fps = Engine.get_frames_per_second()
		state.renderedFrames = Engine.get_frames_drawn()
		state.sceneSettled = world.rendering.scene_settled
		state.loading = is_instance_valid(curtain)
		var request_value: Variant = JavaScriptBridge.eval("JSON.stringify(window.__marketGodotRouteRequest??null)", true)
		var request: Variant = JSON.parse_string(str(request_value))
		if request is Dictionary and str(request.id) != qa_route_request:
			qa_route_request = str(request.id)
			if qa_navigation == null: qa_navigation = NavMeshService.new()
			qa_navigation.rebuild(franchise.unlockedAreas, franchise.unlockedAreas.size())
			qa_route = {"request": qa_route_request, "points": []}
			for zone in world.director._zones:
				if zone.config.id != request.target: continue
				var destination := Vector3(zone.config.x / 2, 0, zone.config.z / 2)
				destination = NavigationServer3D.map_get_closest_point(qa_navigation._map_rid, destination)
				var path := qa_navigation.find_path(world.player_body.position / 6, destination)
				qa_route.points = path.map(func(point): return [point.x * 6, point.z * 6])
				qa_route.zone = zone.config
				break
		state.route = qa_route
	if screen is MarketAuthScreen:
		state.authMode = screen.mode
		state.authMessage = screen.status.text
		state.authBusy = screen.busy
		state.fields = {}
		for key in screen.fields:
			var rect: Rect2 = screen.fields[key].get_global_rect()
			state.fields[key] = [rect.position.x, rect.position.y, rect.size.x, rect.size.y]
		state.buttons = []
		for button in screen.find_children("*", "Button", true, false):
			var rect: Rect2 = button.get_global_rect()
			state.buttons.append({"text": button.text, "disabled": button.disabled, "rect": [rect.position.x, rect.position.y, rect.size.x, rect.size.y]})
	if screen is Shell:
		state.panel = screen.panel
		state.panelRect = []
		state.panelBodyRect = []
		if is_instance_valid(screen.overlay):
			var panel_rect: Rect2 = screen.overlay.get_node("ManagementPanel").get_global_rect()
			state.panelRect = [panel_rect.position.x, panel_rect.position.y, panel_rect.size.x, panel_rect.size.y]
			var body_rect: Rect2 = screen.panel_scroll.get_global_rect()
			state.panelBodyRect = [body_rect.position.x, body_rect.position.y, body_rect.size.x, body_rect.size.y]
		state.avatarPreviewRect = []
		if is_instance_valid(screen.avatar_preview) and screen.avatar_preview.is_visible_in_tree():
			var preview_rect: Rect2 = screen.avatar_preview.get_global_rect()
			state.avatarPreviewRect = [preview_rect.position.x, preview_rect.position.y, preview_rect.size.x, preview_rect.size.y]
		state.portraits = screen.avatar_gallery.images.size() if is_instance_valid(screen.avatar_gallery) else 0
		state.buttons = []
		for button in screen.find_children("*", "Button", true, false):
			if button.is_visible_in_tree():
				var rect: Rect2 = button.get_global_rect()
				state.buttons.append({"name": button.name, "text": button.text, "tooltip": button.tooltip_text, "disabled": button.disabled, "rect": [rect.position.x, rect.position.y, rect.size.x, rect.size.y]})
	JavaScriptBridge.eval("window.__marketGodotQa = %s" % JSON.stringify(state), true)
