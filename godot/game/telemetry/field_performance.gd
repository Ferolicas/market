class_name FieldPerformanceSampler
extends RefCounted
## src/game/telemetry/FieldPerformance.ts. Pure sampling, no network transmission.
var frames: Array = []
var long_tasks: Array = []

func add_frame(delta_ms: float) -> void:
	if not is_finite(delta_ms) or delta_ms <= 0: return
	frames.append(minf(250, delta_ms))

func add_long_task(duration_ms: float) -> void:
	if is_finite(duration_ms) and duration_ms >= 50: long_tasks.append(minf(10000, duration_ms))

func take() -> Dictionary:
	var ordered := frames.duplicate()
	ordered.sort()
	var average: float = JS.sum(frames) / maxf(1, frames.size())
	var p95: float = 0 if ordered.is_empty() else ordered[mini(ordered.size() - 1, floori(ordered.size() * 0.95))]
	var result := {"frameCount": frames.size(), "averageFrameMs": JS.round(average * 100) / 100.0, "p95FrameMs": JS.round(p95 * 100) / 100.0, "maxFrameMs": JS.round(JS.max_of([0] + frames) * 100) / 100.0, "framesOver25": frames.filter(func(value): return value > 25).size(), "framesOver100": frames.filter(func(value): return value > 100).size(), "longTaskCount": long_tasks.size(), "maxLongTaskMs": JS.round(JS.max_of([0] + long_tasks) * 100) / 100.0}
	frames = []
	long_tasks = []
	return result
