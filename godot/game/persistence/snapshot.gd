class_name GameSnapshot
extends RefCounted
const Game = preload("res://game/engine.gd")
const Events = preload("res://game/persistence/domain_events.gd")

static func iso_now() -> String:
	var milliseconds := int(Time.get_unix_time_from_system() * 1000)
	return Time.get_datetime_string_from_unix_time(milliseconds / 1000) + ".%03dZ" % (milliseconds % 1000)

static func create_snapshot(state: Dictionary, now: String = "") -> Dictionary:
	var result := state.duplicate(true)
	result.schemaVersion = 4
	result.lastSavedAt = iso_now() if now.is_empty() else now
	return result

static func restore_pending_event_origins(events: Array, fallback: String) -> Array:
	var result: Array = []
	for event in events:
		if event.get("franchiseId"): result.append(event)
		else:
			var restored: Dictionary = event.duplicate(true)
			restored.franchiseId = fallback
			result.append(restored)
	return result

static func choose_recovery(server: Dictionary, local: Dictionary) -> Dictionary:
	if local.saveRevision != server.saveRevision or local.state.revision <= server.state.revision: return {"source": "server", "envelope": server}
	var pending := restore_pending_event_origins(local.pendingEvents, local.state.currentFranchiseId)
	for event in pending:
		if event.get("eventId") and event.eventId in server.state.processedEventIds: return {"source": "server", "envelope": server}
	var envelope := local.duplicate(true)
	envelope.state = Game.normalize_game_state(local.state)
	envelope.pendingEvents = pending
	return {"source": "local", "envelope": envelope}

static func validate_pending_events(events: Array) -> bool:
	return Events.validate_pending_events(events)

static func capped_offline_elapsed(last_server_time: float, now: float, maximum_ms: float = 6 * 60 * 60 * 1000) -> float:
	return minf(maximum_ms, maxf(0, now - last_server_time))

static func is_pre_register_snapshot(input: Variant) -> bool:
	return input is Dictionary and input.get("franchises") is Array and not input.franchises.is_empty() and input.franchises.all(func(franchise): return franchise is Dictionary and "registerCashMinor" not in franchise)

static func pre_register_checksum_state(state: Dictionary) -> Dictionary:
	var result := state.duplicate(true)
	for franchise in result.franchises: franchise.erase("registerCashMinor")
	return result
