extends TestCase
const Actions = preload("res://game/core/engine_actions.gd")
const Compare = preload("res://tests/oracle_comparison.gd")

func test_contract_deliveries_rejections_inventory_and_events_match_original() -> void:
	var cases: Array = JSON.parse_string(FileAccess.get_file_as_bytes("res://tests/fixtures/contract-oracles.json.gz").decompress_dynamic(256 * 1024 * 1024, FileAccess.COMPRESSION_GZIP).get_string_from_utf8())
	assert_eq(cases.size(), 756)
	for scenario in cases:
		var input: Dictionary = scenario.before.duplicate(true)
		var actual := Actions.apply_game_action(input, scenario.action)
		assert_eq(input, scenario.before, "Contract must preserve input")
		var difference := Compare.difference(Compare.canonical(actual), Compare.canonical(scenario.after))
		if difference != "":
			fail(scenario.label + ": " + difference)
			return
