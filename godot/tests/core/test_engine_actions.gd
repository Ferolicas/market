extends TestCase
const Actions = preload("res://game/core/engine_actions.gd")
var _data: Dictionary = {}

func _oracle() -> Dictionary:
	if _data.is_empty():
		_data = JSON.parse_string(FileAccess.get_file_as_bytes("res://tests/fixtures/action-oracles.json.gz").decompress_dynamic(128 * 1024 * 1024, FileAccess.COMPRESSION_GZIP).get_string_from_utf8())
	return _data

func _canonical(result: Dictionary) -> Dictionary:
	var ids := {}
	var uuid := RegEx.create_from_string("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
	for event in result.events:
		assert_true(uuid.search(event.eventId) != null, "real event UUID")
		assert_eq(event.idempotencyKey, event.eventId)
		assert_contains(result.state.processedEventIds, event.eventId)
	for id in result.state.processedEventIds:
		if uuid.search(id) != null: ids[id] = "<uuid-%d>" % ids.size()
	for order in result.state.pendingOrders:
		if uuid.search(order.id) != null: ids[order.id] = "<uuid-%d>" % ids.size()
	for franchise in result.state.franchises:
		for worker in franchise.employees:
			if uuid.search(worker.id) != null: ids[worker.id] = "<uuid-%d>" % ids.size()
	return _replace_ids(result, ids)

func _replace_ids(value: Variant, ids: Dictionary) -> Variant:
	if value is String: return ids.get(value, value)
	if value is Array: return value.map(func(item): return _replace_ids(item, ids))
	if value is Dictionary:
		var result := {}
		for key in value: result[key] = _replace_ids(value[key], ids)
		return result
	return value

func _difference(actual: Variant, expected: Variant, path: String = "") -> String:
	if actual is Dictionary and expected is Dictionary:
		for key in expected:
			if key not in actual: return path + "." + key + " missing"
			var diff := _difference(actual[key], expected[key], path + "." + key)
			if diff != "": return diff
		for key in actual:
			if key not in expected: return path + "." + key + " unexpected"
		return ""
	if actual is Array and expected is Array:
		if actual.size() != expected.size(): return "%s size: %d != %d" % [path, actual.size(), expected.size()]
		for i in actual.size():
			var diff := _difference(actual[i], expected[i], "%s[%d]" % [path, i])
			if diff != "": return diff
		return ""
	# Godot's JSON decimal parser differs by one ULP for values such as
	# 3.9899999999999998. Only spatial coordinates permit this tolerance;
	# money, quantities, counters, clocks and all other state stay exact.
	if (path.ends_with(".runtime.x") or path.ends_with(".runtime.z")) and actual is float and expected is float and absf(actual - expected) <= 1e-12: return ""
	if (actual is float or actual is int) and (expected is float or expected is int) and actual != expected:
		return "%s: %.17f != %.17f" % [path, actual, expected]
	return "" if actual == expected else "%s: %s != %s" % [path, str(actual), str(expected)]

func test_all_action_states_events_and_messages_match_original() -> void:
	for scenario in _oracle().actions:
		var input: Dictionary = scenario.before.duplicate(true)
		var actual := Actions.apply_game_action(input, scenario.action)
		var diff := _difference(input, scenario.before)
		assert_eq(diff, "", "input must remain unchanged")
		diff = _difference(_canonical(actual), scenario.after)
		if diff != "":
			fail("%s %s: %s" % [scenario.label, str(scenario.action), diff])
			return

func test_coarse_clock_matches_original_without_manufacturing_or_sales() -> void:
	for scenario in _oracle().coarse:
		var input: Dictionary = scenario.before.duplicate(true)
		var actual := Actions.advance_simulation(input, scenario.minutes)
		assert_eq(_difference(input, scenario.before), "", "input must remain unchanged")
		var diff := _difference(_canonical(actual), scenario.after)
		if diff != "":
			fail(diff)
			return
