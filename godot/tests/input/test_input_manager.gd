extends TestCase
## Port of src/game/input/InputManager.test.ts (covers DragJoystick too).

func _matches(actual: Dictionary, expected: Dictionary) -> void:
	for key in expected: assert_eq(actual.get(key), expected[key], key)

func test_applies_the_specified_radial_deadzone_and_magnitude() -> void:
	assert_eq(InputManager.radial_input(4, 0, 80, 8).magnitude, 0)
	_matches(InputManager.radial_input(44, 0, 80, 8), { "x": 1, "y": 0, "magnitude": 0.5 })
	assert_eq(InputManager.radial_input(200, 0, 80, 8).magnitude, 1)

func test_chooses_the_strongest_source_instead_of_adding_inputs() -> void:
	var chosen := InputManager.strongest_input([{ "x": 1, "y": 0, "magnitude": 0.3 }, { "x": 0, "y": 1, "magnitude": 0.8 }])
	assert_eq(chosen, { "x": 0, "y": 1, "magnitude": 0.8 })
	var manager := InputManager.new()
	manager.set_keyboard(1, 0)
	manager.set_pointer({ "x": 0, "y": 1, "magnitude": 0.5 })
	_matches(manager.sample(), { "x": 1, "y": 0, "magnitude": 1 })

func test_keeps_the_first_pointer_and_clamps_only_the_visual_thumb() -> void:
	var drag := DragJoystick.new()
	assert_true(drag.begin(3, 100, 120, 800, 600))
	assert_false(drag.begin(4, 200, 220, 800, 600))
	var sample: Dictionary = drag.move(3, 500, 120)
	assert_eq(sample.input.magnitude, 1)
	assert_eq(sample.thumbX, drag.visual_radius)
	assert_false(drag.end(4))
	assert_true(drag.end(3))
