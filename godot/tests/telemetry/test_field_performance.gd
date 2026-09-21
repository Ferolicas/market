extends TestCase
const Sampler = preload("res://game/telemetry/field_performance.gd")
func test_summarizes_without_retaining_old_windows() -> void:
	var sampler = Sampler.new()
	for i in 95: sampler.add_frame(16.7)
	for i in 5: sampler.add_frame(50)
	sampler.add_frame(530) # a genuine hitch, e.g. a mid-play synchronous stall
	sampler.add_long_task(82)
	var result: Dictionary = sampler.take()
	assert_eq(result.frameCount, 101)
	assert_eq(result.p95FrameMs, 50)
	# p95 does not move for one rare hitch among 101 frames; maxFrameMs is what
	# actually surfaces it (capped at 250 to match add_frame's own clamp).
	assert_eq(result.maxFrameMs, 250)
	assert_eq(result.framesOver25, 6)
	assert_eq(result.framesOver100, 1)
	assert_eq(result.longTaskCount, 1)
	assert_eq(result.maxLongTaskMs, 82)
	var drained := sampler.take()
	assert_eq(drained.frameCount, 0)
	assert_eq(drained.maxFrameMs, 0)
