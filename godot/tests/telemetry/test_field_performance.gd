extends TestCase
const Sampler = preload("res://game/telemetry/field_performance.gd")
func test_summarizes_without_retaining_old_windows() -> void:
	var sampler = Sampler.new()
	for i in 95: sampler.add_frame(16.7)
	for i in 5: sampler.add_frame(50)
	sampler.add_long_task(82)
	var result: Dictionary = sampler.take()
	assert_eq(result.frameCount, 100)
	assert_eq(result.p95FrameMs, 50)
	assert_eq(result.framesOver25, 5)
	assert_eq(result.longTaskCount, 1)
	assert_eq(result.maxLongTaskMs, 82)
	assert_eq(sampler.take().frameCount, 0)
