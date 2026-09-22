class_name MarketClientTelemetry
extends Node
## GameRuntime + lib/client-telemetry: original authenticated endpoint and schema.
var store: MarketStore
var world: MarketWorld
var sampler := FieldPerformanceSampler.new()
var elapsed := 0.0
var previous_status := ""
var log_elapsed := 0.0
const LOG_FLUSH_INTERVAL_S := 5.0
const LOG_BATCH_SIZE := 8

func _ready() -> void:
	if store != null: store.changed.connect(_save_changed)
	if OS.has_feature("web"):
		JavaScriptBridge.eval(FileAccess.get_file_as_string("res://game/telemetry/browser_performance.js"), true)
		var metadata := body({"kind": "webgl"}, str(JavaScriptBridge.eval("location.pathname + location.search", true)), ClientIdentity.game_device_id(), ClientIdentity.game_session_id())
		JavaScriptBridge.eval("window.__marketFieldPerformance.telemetry = %s" % JSON.stringify(metadata), true)

static func body(input: Dictionary, route: String, device: String, session: String) -> Dictionary:
	var result := input.duplicate(true)
	if result.has("message"): result.message = str(result.message).left(1000)
	result.route = route.left(300)
	result.deviceId = device
	result.sessionId = session
	return result

func report(input: Dictionary, keepalive := false) -> Dictionary:
	if store == null or store.api == null: return {"ok": false, "status": 0}
	var route := "/"
	if OS.has_feature("web"): route = str(JavaScriptBridge.eval("location.pathname + location.search", true))
	var data := body(input, route, ClientIdentity.game_device_id(), ClientIdentity.game_session_id())
	if OS.has_feature("web") and keepalive:
		JavaScriptBridge.eval("fetch('/api/game/telemetry',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',keepalive:true,body:%s}).catch(()=>{});" % JSON.stringify(JSON.stringify(data)), true)
		return {"queued": true, "status": 0}
	return await store.api.request_json("/api/game/telemetry", "POST", data)

func _save_changed() -> void:
	if previous_status == store.save_status: return
	previous_status = store.save_status
	if previous_status in ["offline", "conflict", "error"]:
		report({"kind": "save", "name": previous_status, "severity": "error" if previous_status == "error" else "warning", "message": store.message})

## One batch of PerformanceLog lines, e.g. {"n": 3, "l0": "...", "l1": "...",
## "l2": "..."} — the whole-session timeline (open to close), not just the
## handful of subsystems picked by hand so far. One batch per
## LOG_FLUSH_INTERVAL_S keeps this at most 12/minute, matching the telemetry
## endpoint's own rate limit even during a burst of hitches.
func flush_performance_log() -> void:
	var batch := PerformanceLog.take_batch(LOG_BATCH_SIZE)
	if batch.is_empty(): return
	var payload := {"n": batch.size()}
	for index in batch.size(): payload["l%d" % index] = batch[index]
	report({"kind": "performance", "name": "session-log", "payload": payload})

## Drains everything still unflushed in one go — used only when the app is
## about to background or close, where there will be no next _process tick
## to send it gradually. Best-effort: some of these may race the app's
## actual suspension and never land, same as the existing save(true)/
## flush_recovery_snapshot() calls on the same lifecycle events.
func flush_performance_log_immediately() -> void:
	while PerformanceLog.has_unflushed(): flush_performance_log()

func _process(delta: float) -> void:
	if not OS.has_feature("web"): sampler.add_frame(delta * 1000)
	log_elapsed += delta
	if log_elapsed >= LOG_FLUSH_INTERVAL_S:
		log_elapsed = 0
		flush_performance_log()
	elapsed += delta
	if elapsed < 60: return
	elapsed = 0
	if OS.has_feature("web"):
		if not bool(JavaScriptBridge.eval("document.visibilityState === 'visible'", true)): return
		var raw: Variant = JavaScriptBridge.eval("window.__marketFieldPerformance.take()", true)
		var data: Dictionary = JSON.parse_string(str(raw))
		for frame in data.frames: sampler.add_frame(frame)
		for duration in data.longTasks: sampler.add_long_task(duration)
	var summary := sampler.take()
	if summary.frameCount < 30 or store == null: return
	var state: Variant = store.game
	var franchise: Variant = EngineProgression.current_franchise(state) if state != null else null
	summary.level = state.level if state != null else null
	summary.customers = franchise.customers.size() if franchise != null else null
	summary.employees = franchise.employees.size() if franchise != null else null
	var viewport := get_viewport().get_visible_rect().size
	summary.viewportWidth = viewport.x
	summary.viewportHeight = viewport.y
	summary.devicePixelRatio = 1.0
	if OS.has_feature("web"):
		summary.viewportWidth = JavaScriptBridge.eval("innerWidth", true)
		summary.viewportHeight = JavaScriptBridge.eval("innerHeight", true)
		summary.devicePixelRatio = JavaScriptBridge.eval("devicePixelRatio", true)
	if store != null and store.recovery != null: summary.merge(store.recovery.take_persist_stats())
	if is_instance_valid(world): summary.merge(world.take_actor_creation_stats())
	summary.merge(MarketActor.take_rig_phase_stats())
	report({"kind": "performance", "name": "one-minute-window", "severity": "warning" if summary.p95FrameMs > 40 or summary.longTaskCount > 2 or summary.get("recoveryPersistMaxMs", 0) > 200 or summary.get("actorCreationMaxMs", 0) > 100 else "info", "payload": summary})

func _exit_tree() -> void:
	if OS.has_feature("web"): JavaScriptBridge.eval("window.__marketFieldPerformance?.close(); delete window.__marketFieldPerformance;", true)
