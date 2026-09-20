extends TestCase
const Monitor = preload("res://game/debug/performance_monitor.gd")
func test_half_second_window_and_percentile() -> void:
	var monitor = Monitor.new()
	var result: Variant = null
	for i in 31:
		if result == null: result = monitor.sample(20 if i == 30 else 16.67, {"drawCalls": 80, "triangles": 120000, "points": 0, "lines": 4, "geometries": 42, "textures": 12, "programs": 5})
	assert_eq(result.fps, 60)
	assert_near(result.averageFrameMs, 16.67)
	assert_near(result.p95FrameMs, 16.67)
	assert_eq(result.drawCalls, 80)
	assert_eq(result.triangles, 120000)
	assert_eq(result.lines, 4)
	assert_null(monitor.sample(10, {}))
