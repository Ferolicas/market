extends TestCase
const Presentation = preload("res://game/scene/customer_animation.gd")

func test_animation_selection_matches_original_states_and_phase_boundaries() -> void:
	var cases: Array = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/customer-animation-oracles.json"))
	assert_gt(cases.size(), 10000)
	for example in cases:
		var actual := Presentation.select(example.customer, example.simulationTimeMs, example.elapsed, example.checkoutLoading, example.runsFree)
		assert_eq(actual, example.expected, str(example))
		if actual != example.expected: return
