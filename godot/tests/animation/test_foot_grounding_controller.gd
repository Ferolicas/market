extends TestCase

func test_calibrates_the_sole_and_limits_ik_correction_to_three_centimetres() -> void:
	var controller := FootGroundingController.new()
	controller.calibrate(0.08, 0.0)
	assert_near(controller.solve(0.06, 0.0, 1.0), 0.02, 0.005)
	assert_eq(controller.solve(0.5, 0.0, 1.0), -0.03)
	assert_eq(controller.solve(-0.5, 0.0, 1.0), 0.03)
	assert_eq(controller.solve(0.06, 0.0, 0.0), 0.0)
