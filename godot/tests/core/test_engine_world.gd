extends TestCase
const Game = preload("res://game/engine.gd")
const Compare = preload("res://tests/oracle_comparison.gd")
var _data: Dictionary = {}

func _oracle() -> Dictionary:
	if _data.is_empty(): _data = JSON.parse_string(FileAccess.get_file_as_bytes("res://tests/fixtures/world-oracles.json.gz").decompress_dynamic(256 * 1024 * 1024, FileAccess.COMPRESSION_GZIP).get_string_from_utf8())
	return _data

func test_restored_station_clocks_staff_routes_and_campaign_state_match_original() -> void:
	var index := 0
	for scenario in _oracle().normalize:
		var input: Dictionary = scenario.before.duplicate(true)
		var actual := Game.normalize_game_state(input)
		assert_eq(Compare.difference(input, scenario.before), "", "normalization preserves its input")
		var diff := Compare.difference(actual, scenario.after)
		if diff != "":
			fail("restore %d: %s" % [index, diff])
			return
		index += 1

func test_six_minutes_of_customers_staff_production_and_closure_match_original() -> void:
	for scenario in _oracle().world:
		var state: Dictionary = scenario.before.duplicate(true)
		var events: Array = []
		var next_checkpoint := 0
		for tick in range(1, int(scenario.checkpoints.back().tick) + 1):
			var world_input: Dictionary = {"playerDistanceMeters": 0.75, "interactions": [{"type": "STOCK", "productId": "tomatoes", "quantity": 1}, {"type": "CHECKOUT", "paymentMethod": "card"}]} if tick % 25 == 0 else {}
			var result := Game.advance_world(state, 1000, Callable(), world_input)
			state = result.state
			events.append_array(result.events)
			if tick == scenario.checkpoints[next_checkpoint].tick:
				var diff := Compare.difference(Compare.canonical(result), Compare.canonical(scenario.checkpoints[next_checkpoint].result))
				if diff != "":
					fail("%s tick %d: %s" % [scenario.label, tick, diff])
					return
				next_checkpoint += 1
		var diff := Compare.difference(Compare.canonical(events), Compare.canonical(scenario.events))
		if diff != "":
			fail("%s event history: %s" % [scenario.label, diff])
			return
