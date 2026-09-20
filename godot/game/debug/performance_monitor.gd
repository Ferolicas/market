class_name PerformanceMonitor
extends RefCounted
## src/game/debug/PerformanceMonitor.ts
var frames: Array = []
var elapsed_ms := 0.0

func sample(delta_ms: float, renderer: Dictionary) -> Variant:
	var frame := clampf(delta_ms, 0, 250)
	frames.append(frame)
	elapsed_ms += frame
	if elapsed_ms < 500: return null
	var ordered := frames.duplicate()
	ordered.sort()
	var p95: float = ordered[mini(ordered.size() - 1, floori(ordered.size() * 0.95))]
	var average: float = JS.sum(frames) / maxf(1, frames.size())
	var metrics := renderer.duplicate()
	metrics.merge({"fps": JS.round(1000 / average) if average > 0 else 0, "averageFrameMs": JS.round(average * 100) / 100.0, "p95FrameMs": JS.round(p95 * 100) / 100.0}, true)
	frames = []
	elapsed_ms = 0
	return metrics
