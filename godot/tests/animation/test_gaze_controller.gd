extends TestCase

func test_is_deterministic_asynchronous_by_seed_and_anatomically_bounded() -> void:
	var first := GazeController.new(3).sample(8.0, "queue")
	assert_eq(first, GazeController.new(3).sample(8.0, "queue"))
	assert_ne(first, GazeController.new(4).sample(8.0, "queue"))
	assert_lte(absf(first.yaw), 0.35)
	assert_gte(first.pitch, -0.18)
	assert_lte(first.pitch, 0.28)
