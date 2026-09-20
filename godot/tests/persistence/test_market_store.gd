extends TestCase
const Store = preload("res://game/store.gd")
const Recovery = preload("res://game/persistence/recovery_storage.gd")
const Snapshot = preload("res://game/persistence/snapshot.gd")
const Game = preload("res://game/engine.gd")
var store: Store
var directory: String

func before_each() -> void:
	directory = "user://test-recovery-" + JS.uuid()
	store = Store.new()
	store.recovery = Recovery.new()
	store.recovery.directory = directory
	store.add_child(store.recovery)
	Engine.get_main_loop().root.add_child(store)
	store.game = Game.create_initial_game()
	store.save_revision = 4
	store.save_status = "dirty"

func after_each() -> void:
	store.recovery.flush_recovery_snapshot()
	store.free()
	NavMeshService.dispose_store_navigation()
	var dir := DirAccess.open(directory)
	if dir != null:
		for file in dir.get_files(): dir.remove(file)
		DirAccess.remove_absolute(directory)

func _ready_crop() -> void:
	store.game.franchises[0].crops[0].merge({"status": "READY", "available": 1, "readyAt": 0}, true)

func test_consumes_proximity_pulses_once_while_a_save_is_in_flight() -> void:
	_ready_crop()
	var attempt: Dictionary = store.begin_save_attempt()
	assert_eq(store.save_status, "saving")
	store.queue_interaction({"type": "HARVEST", "cropId": "crop-tomato-1", "productId": "tomatoes"})
	store.tick_world(100)
	assert_eq(store.save_status, "saving")
	assert_eq(store.game.franchises[0].carry.items.tomatoes, 1)
	assert_eq(store.game.franchises[0].crops[0].status, "GROWING")
	assert_null(store.begin_save_attempt())
	store.finish_save_attempt(attempt, {"ok": true, "status": 200, "data": {"saveRevision": 5}})
	assert_eq(store.game.franchises[0].carry.items.tomatoes, 1)
	assert_eq(store.save_revision, 5)
	assert_eq(store.save_status, "dirty")
	store.tick_world(100)
	assert_eq(store.game.franchises[0].carry.items.tomatoes, 1)

func test_conflict_preserves_newest_state_and_events_on_disk() -> void:
	_ready_crop()
	var attempt: Dictionary = store.begin_save_attempt()
	store.queue_interaction({"type": "HARVEST", "cropId": "crop-tomato-1"})
	store.tick_world(100)
	store.dispatch({"type": "ORDER", "supplierId": "campo", "productId": "wheat", "quantity": 1})
	store.finish_save_attempt(attempt, {"ok": false, "status": 409, "data": {"state": attempt.state, "saveRevision": 9}})
	assert_eq(store.game.franchises[0].carry.items.tomatoes, 1)
	assert_gt(store.pending_events.size(), 0)
	assert_eq(store.save_revision, 4)
	assert_eq(store.save_status, "conflict")
	assert_contains(store.message, "no fue sustituido")
	var saved: Dictionary = store.recovery.read_recovery_snapshot()
	assert_eq(saved.state, store.game)
	assert_eq(saved.pendingEvents, store.pending_events)
	assert_eq(saved.pendingSave.operationId, attempt.operationId)

func test_offline_retry_reuses_operation_id_and_repeats_message_occurrence() -> void:
	var first: Dictionary = store.begin_save_attempt()
	store.finish_save_attempt(first, {"ok": false, "status": 0, "data": {}})
	assert_eq(store.save_status, "offline")
	assert_eq(store.message_revision, 1)
	var text := store.message
	var second: Dictionary = store.begin_save_attempt()
	assert_eq(second.operationId, first.operationId)
	store.finish_save_attempt(second, {"ok": false, "status": 0, "data": {}})
	assert_eq(store.message, text)
	assert_eq(store.message_revision, 2)

func test_schema_rejection_rebuilds_attempt_instead_of_replaying_bad_body() -> void:
	var first: Dictionary = store.begin_save_attempt()
	store.finish_save_attempt(first, {"ok": false, "status": 400, "data": {"error": "INVALID_SAVE", "issues": [{"path": ["state", "level"], "message": "Invalid"}]}})
	assert_null(store.pending_save_attempt)
	assert_eq(store.save_status, "error")
	assert_contains(store.message, "state.level: Invalid")
	store.dispatch({"type": "SET_AVATAR", "hat": "frog"})
	var second: Dictionary = store.begin_save_attempt()
	assert_ne(second.operationId, first.operationId)
	assert_eq(second.state.avatar.hat, "frog")
	store.finish_save_attempt(second, {"ok": false, "status": 429, "data": {}})
	assert_eq(store.save_status, "offline")
	assert_eq(store.pending_save_attempt.operationId, second.operationId)

func test_lost_ack_recovers_newer_local_work_without_resending_applied_events() -> void:
	store.dispatch({"type": "ORDER", "supplierId": "campo", "productId": "wheat", "quantity": 1})
	var attempt: Dictionary = store.begin_save_attempt()
	store.dispatch({"type": "SET_AVATAR", "hat": "frog"})
	var local := {"state": store.game, "saveRevision": 4, "pendingEvents": store.pending_events, "pendingSave": attempt}
	store.accept_server_load({"state": attempt.state, "saveRevision": 5, "lastOperationId": attempt.operationId}, local)
	assert_eq(store.game.avatar.hat, "frog")
	assert_eq(store.pending_events, [])
	assert_null(store.pending_save_attempt)
	assert_eq(store.save_revision, 5)
	assert_eq(store.save_status, "dirty")

func test_offline_legacy_events_recover_origin_and_account_scopes_do_not_mix() -> void:
	var ordered := Game.apply_game_action(store.game, {"type": "ORDER", "supplierId": "campo", "productId": "wheat", "quantity": 1})
	ordered.events[0].erase("franchiseId")
	store.recovery.set_recovery_scope("a".repeat(32))
	assert_true(store.recovery.persist_recovery_snapshot({"state": ordered.state, "saveRevision": 4, "pendingEvents": ordered.events}))
	store._load_offline()
	assert_eq(store.save_status, "offline")
	assert_eq(store.pending_events[0].franchiseId, ordered.state.currentFranchiseId)
	store.recovery.set_recovery_scope("b".repeat(32))
	assert_null(store.recovery.read_recovery_snapshot())
	store.recovery.set_recovery_scope("a".repeat(32))
	assert_not_null(store.recovery.read_recovery_snapshot())

func test_coalesced_recovery_flushes_only_latest_state_and_survives_reopening() -> void:
	store.dispatch({"type": "SET_AVATAR", "hat": "frog"})
	store.dispatch({"type": "SET_AVATAR", "hat": "owl"})
	store.recovery.flush_recovery_snapshot()
	var reader := Recovery.new()
	reader.directory = directory
	var saved: Dictionary = reader.read_recovery_snapshot()
	assert_eq(saved.state.avatar.hat, "owl")
	assert_eq(saved.state.revision, 2)
	reader.free()

func test_snapshot_choice_rejects_replayed_events_and_changed_server_revision() -> void:
	var ordered := Game.apply_game_action(store.game, {"type": "ORDER", "supplierId": "campo", "productId": "wheat", "quantity": 1})
	var server := {"state": store.game.duplicate(true), "saveRevision": 4, "pendingEvents": []}
	var local := {"state": ordered.state, "saveRevision": 4, "pendingEvents": ordered.events}
	assert_eq(Snapshot.choose_recovery(server, local).source, "local")
	server.state.processedEventIds.append(ordered.events[0].eventId)
	assert_eq(Snapshot.choose_recovery(server, local).source, "server")
	server.state.processedEventIds = []
	server.saveRevision = 5
	assert_eq(Snapshot.choose_recovery(server, local).source, "server")
	assert_eq(Snapshot.capped_offline_elapsed(0, 24 * 60 * 60 * 1000), 6 * 60 * 60 * 1000)

func test_save_response_after_logout_cannot_restore_old_account() -> void:
	var attempt: Dictionary = store.begin_save_attempt()
	# The application clears its game on logout. A delayed PUT must not undo it.
	store.game = null
	store.recovery.clear_recovery_snapshot()
	store.finish_save_attempt(attempt, {"ok": true, "status": 200, "data": {"saveRevision": 5}})
	assert_null(store.game)
	assert_null(store.recovery.read_recovery_snapshot())

func test_old_account_response_cannot_modify_a_new_account_save() -> void:
	var previous: Dictionary = store.begin_save_attempt()
	store.reset_session()
	store.game = Game.create_campaign_game("CO")
	store.save_revision = 1
	var current: Dictionary = store.begin_save_attempt()
	store.finish_save_attempt(previous, {"ok": true, "status": 200, "data": {"saveRevision": 5}})
	assert_eq(store.game.countryCode, "CO")
	assert_eq(store.save_revision, 1)
	assert_true(store.save_in_flight)
	assert_eq(store.pending_save_attempt.operationId, current.operationId)
	store.finish_save_attempt(current, {"ok": true, "status": 200, "data": {"saveRevision": 2}})
	assert_eq(store.save_revision, 2)
