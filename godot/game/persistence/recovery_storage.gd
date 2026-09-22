class_name RecoveryStorage
extends Node
## Durable per-account recovery. Godot's user:// also persists in web exports.
## Writes replace atomically; a failed write leaves the previous snapshot intact.
const CAMPAIGN_RELEASE = "campaign-30-20260915"
const CAMPAIGN_SAVE_SLOT = 2
const RECOVERY_WRITE_INTERVAL_MS = 3000
var directory: String = "user://recovery-" + CAMPAIGN_RELEASE
var active_scope: String = ""
var queued_snapshot: Variant = null
var last_write_at: int = 0
var last_write_error: Error = OK
var _timer: Timer
## Every persist duplicates the full game state, serializes it to JSON and
## writes it to disk on the main thread; tracked here so client_telemetry can
## fold it into its periodic report and confirm/rule out the recovery-write
## cadence (every RECOVERY_WRITE_INTERVAL_MS) as a source of in-game hitches.
var _persist_count := 0
var _persist_max_ms := 0
var _persist_over_threshold_count := 0
var _persist_slowest_breakdown := {}
const PERSIST_STALL_THRESHOLD_MS = 80

func _record_persist_timing(total_ms: int, duplicate_ms: int, stringify_ms: int, write_ms: int) -> void:
	_persist_count += 1
	if total_ms >= _persist_max_ms:
		_persist_max_ms = total_ms
		_persist_slowest_breakdown = {"recoveryPersistDuplicateMs": duplicate_ms, "recoveryPersistStringifyMs": stringify_ms, "recoveryPersistWriteMs": write_ms}
	if total_ms >= PERSIST_STALL_THRESHOLD_MS: _persist_over_threshold_count += 1

## Drains and resets the stats gathered since the last call.
func take_persist_stats() -> Dictionary:
	var stats := {"recoveryPersistCount": _persist_count, "recoveryPersistMaxMs": _persist_max_ms, "recoveryPersistOverThresholdCount": _persist_over_threshold_count}
	if not _persist_slowest_breakdown.is_empty(): stats.merge(_persist_slowest_breakdown)
	_persist_count = 0
	_persist_max_ms = 0
	_persist_over_threshold_count = 0
	_persist_slowest_breakdown = {}
	return stats

func _ready() -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval(FileAccess.get_file_as_string("res://game/persistence/browser_recovery.js"), true)
		var browser_scope: Variant = JavaScriptBridge.eval("window.__marketGodotRecovery.scope()", true)
		if browser_scope is String and not browser_scope.is_empty(): active_scope = browser_scope
	DirAccess.make_dir_recursive_absolute(directory)
	var scope_path := directory.path_join("scope")
	if active_scope.is_empty() and FileAccess.file_exists(scope_path): set_recovery_scope(FileAccess.get_file_as_string(scope_path))
	_timer = Timer.new()
	_timer.one_shot = true
	add_child(_timer)
	_timer.timeout.connect(flush_recovery_snapshot)

func set_recovery_scope(scope_id: String) -> void:
	if RegEx.create_from_string("(?i)^[a-f0-9]{32,64}$").search(scope_id) == null: return
	active_scope = scope_id.to_lower()
	if OS.has_feature("web"): JavaScriptBridge.eval("window.__marketGodotRecovery.setScope(%s)" % JSON.stringify(active_scope), true)
	DirAccess.make_dir_recursive_absolute(directory)
	var file := FileAccess.open(directory.path_join("scope"), FileAccess.WRITE)
	if file != null: file.store_string(active_scope)

func _path() -> String:
	return directory.path_join("scope-" + active_scope + "-slot-1.json" if not active_scope.is_empty() else "current.json")

func read_recovery_snapshot() -> Variant:
	var candidates: Array = []
	var paths: Array = [_path()]
	if not active_scope.is_empty(): paths.append(directory.path_join("current.json"))
	for path in paths:
		if not FileAccess.file_exists(path): continue
		var value: Variant = preload("res://game/util/json_exact.gd").parse(FileAccess.get_file_as_string(path))
		if not value is Dictionary or not value.get("state") is Dictionary or "saveRevision" not in value: continue
		if not active_scope.is_empty() and value.get("scopeId") and value.scopeId != active_scope: continue
		candidates.append(value)
	candidates.sort_custom(func(a, b): return a.saveRevision > b.saveRevision if a.state.revision == b.state.revision else a.state.revision > b.state.revision)
	return null if candidates.is_empty() else candidates[0]

func queue_recovery_snapshot(snapshot: Dictionary) -> void:
	# Engine snapshots are immutable after publication; serialize only at flush.
	queued_snapshot = snapshot
	if _timer == null:
		flush_recovery_snapshot()
	elif _timer.is_stopped():
		_timer.start(maxf(0.001, (RECOVERY_WRITE_INTERVAL_MS - (Time.get_ticks_msec() - last_write_at)) / 1000.0))

func flush_recovery_snapshot() -> void:
	if _timer != null: _timer.stop()
	var snapshot: Variant = queued_snapshot
	queued_snapshot = null
	if snapshot != null: persist_recovery_snapshot(snapshot)

func persist_recovery_snapshot(snapshot: Dictionary) -> bool:
	queued_snapshot = null
	if _timer != null: _timer.stop()
	var call_start := Time.get_ticks_msec()
	var duplicate_start := call_start
	var data := snapshot.duplicate(true)
	if not active_scope.is_empty(): data.scopeId = active_scope
	var duplicate_ms := Time.get_ticks_msec() - duplicate_start
	DirAccess.make_dir_recursive_absolute(directory)
	var path := _path()
	var temporary := path + ".tmp"
	var file := FileAccess.open(temporary, FileAccess.WRITE)
	if file == null:
		last_write_error = FileAccess.get_open_error()
		return false
	var stringify_start := Time.get_ticks_msec()
	var json := JSON.stringify(data, "", false, true)
	var stringify_ms := Time.get_ticks_msec() - stringify_start
	var write_start := Time.get_ticks_msec()
	file.store_string(json)
	file.flush()
	var write_ms := Time.get_ticks_msec() - write_start
	last_write_error = file.get_error()
	file.close()
	var persist_total_ms := Time.get_ticks_msec() - call_start
	_record_persist_timing(persist_total_ms, duplicate_ms, stringify_ms, write_ms)
	PerformanceLog.record("recovery_persist", persist_total_ms, {"dup": duplicate_ms, "json": stringify_ms, "write": write_ms})
	if last_write_error != OK: return false
	last_write_error = DirAccess.rename_absolute(temporary, path)
	if last_write_error != OK: return false
	last_write_at = Time.get_ticks_msec()
	if OS.has_feature("web"): JavaScriptBridge.eval("void window.__marketGodotRecovery.persist(%s)" % JSON.stringify(data, "", false, true), true)
	return true

func has_recovery_snapshot_hint() -> bool:
	return FileAccess.file_exists(_path()) or FileAccess.file_exists(directory.path_join("current.json"))

func clear_recovery_snapshot() -> void:
	if OS.has_feature("web"): JavaScriptBridge.eval("void window.__marketGodotRecovery.clear()", true)
	queued_snapshot = null
	if _timer != null: _timer.stop()
	if FileAccess.file_exists(_path()): DirAccess.remove_absolute(_path())

func _exit_tree() -> void:
	flush_recovery_snapshot()

func import_browser_recovery() -> void:
	if not OS.has_feature("web"): return
	var token := JS.uuid()
	JavaScriptBridge.eval("window.__marketGodotRecovery.requestRead(%s)" % JSON.stringify(token), true)
	var deadline := Time.get_ticks_msec() + 5000
	while Time.get_ticks_msec() < deadline:
		var result: Variant = JavaScriptBridge.eval("window.__marketGodotRecovery.results[%s] ?? null" % JSON.stringify(token), true)
		if result is String:
			JavaScriptBridge.eval("delete window.__marketGodotRecovery.results[%s]" % JSON.stringify(token), true)
			var browser: Variant = preload("res://game/util/json_exact.gd").parse(result)
			if browser is Dictionary and browser.get("state") is Dictionary and browser.has("saveRevision"):
				var local: Variant = read_recovery_snapshot()
				if local == null or browser.state.revision > local.state.revision or (browser.state.revision == local.state.revision and browser.saveRevision > local.saveRevision): persist_recovery_snapshot(browser)
			return
		await get_tree().process_frame
