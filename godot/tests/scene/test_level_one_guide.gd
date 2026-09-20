extends TestCase
const Guide = preload("res://game/ui/level_one_guide.gd")
func test_initial_guide_matches_original_across_the_complete_first_sale() -> void:
	var cases: Array = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/guide-oracles.json"))
	assert_eq(cases.size(), 1536)
	for example in cases:
		assert_eq(Guide.presentation(example.game, example.franchise), example.expected, str(example))
