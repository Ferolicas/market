extends TestCase
func test_legacy_shopping_lists_match_reference_v8_random_comparisons() -> void:
	var scenarios: Array = JSON.parse_string(FileAccess.get_file_as_bytes("res://tests/fixtures/customer-oracles.json.gz").decompress_dynamic(4 * 1024 * 1024, FileAccess.COMPRESSION_GZIP).get_string_from_utf8())
	for scenario in scenarios:
		var actual := CustomerBrain.create_customer_mind("customer", scenario.products, int(scenario.seed), scenario.level)
		assert_eq(actual, scenario.result, "level %d seed %d" % [scenario.level, scenario.seed])
