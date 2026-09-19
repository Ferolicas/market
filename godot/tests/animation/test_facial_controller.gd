extends TestCase

func test_compone_expresiones_y_parpadeos_deterministas() -> void:
	var a := FacialController.new(4).weights(3.2, "Confused")
	var b := FacialController.new(4).weights(3.2, "Confused")
	assert_eq(a, b)
	assert_eq(a.MouthNarrow, 0.25)
