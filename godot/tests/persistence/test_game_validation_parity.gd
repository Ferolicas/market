extends TestCase
const Validation = preload("res://game/persistence/game_validation.gd")
const Comparison = preload("res://tests/oracle_comparison.gd")

func test_source_zod_validation_and_transform_parity() -> void:
	var compressed := FileAccess.get_file_as_bytes("res://tests/fixtures/validation-oracles.json.gz")
	var fixture: Dictionary = preload("res://game/util/json_exact.gd").parse(compressed.decompress_dynamic(256 * 1024 * 1024, FileAccess.COMPRESSION_GZIP).get_string_from_utf8())
	var cases: Array = fixture.cases
	assert_gt(cases.size(), 1000)
	for example in cases:
		var input: Variant = example.get("input", fixture.base).duplicate(true)
		if "mutation" in example:
			var mutation: Dictionary = example.mutation
			var parent: Variant = input
			for key in mutation.path.slice(0, -1): parent = parent[int(key)] if parent is Array else parent[key]
			var key: Variant = int(mutation.path[-1]) if parent is Array else mutation.path[-1]
			if mutation.remove:
				if parent is Array: parent[key] = null
				else: parent.erase(key)
			else: parent[key] = mutation.value
		var result := Validation.safe_parse_save_payload(input)
		assert_eq(result.success, example.success, example.label)
		if result.success != example.success: return
		if result.success:
			var difference := Comparison.difference(result.data, example.data)
			assert_eq(difference, "", example.label)
			if difference != "": return
