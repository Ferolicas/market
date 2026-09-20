class_name FixedStepLoop
extends RefCounted
## src/game/core/GameLoop.ts: bounded fixed simulation steps, render interpolation.
var step_seconds: float
var max_sub_steps: int
var accumulator := 0.0
var last_time_seconds: Variant = null
var dropped_seconds := 0.0

func _init(step: float = 1.0 / 60.0, maximum: int = 5) -> void:
	assert(step > 0, "stepSeconds must be positive")
	assert(maximum >= 1, "maxSubSteps must be a positive integer")
	step_seconds = step
	max_sub_steps = maximum

func reset(now_seconds: Variant = null) -> void:
	accumulator = 0
	last_time_seconds = now_seconds
	dropped_seconds = 0

func advance(now_seconds: float, tick: Callable) -> Dictionary:
	if last_time_seconds == null:
		last_time_seconds = now_seconds
		return {"steps": 0, "alpha": 0, "droppedSeconds": dropped_seconds}
	var elapsed := maxf(0, now_seconds - last_time_seconds)
	last_time_seconds = now_seconds
	var maximum_accepted := step_seconds * max_sub_steps
	if elapsed > maximum_accepted: dropped_seconds += elapsed - maximum_accepted
	accumulator += minf(elapsed, maximum_accepted)
	var steps := 0
	while accumulator + JS.EPSILON >= step_seconds and steps < max_sub_steps:
		tick.call(step_seconds)
		accumulator -= step_seconds
		steps += 1
	return {"steps": steps, "alpha": clampf(accumulator / step_seconds, 0, 1), "droppedSeconds": dropped_seconds}
