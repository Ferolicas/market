extends TestCase
## Port of src/game/interaction/InteractionZone.test.ts

func _fixture_zone() -> Dictionary:
	return {
		"id": "stock:produce",
		"type": "stock:produce",
		"x": 10,
		"z": -4,
		"halfExtents": [2, 1],
		"enterRadius": 0.8,
		"exitRadius": 1,
		"actorMask": ["player"],
		"priority": 80,
		"dwellMs": 0,
		"repeatEveryMs": 180,
		"exitGraceMs": 0,
		"channel": "transfer",
	}

func _signals(events: Array) -> Array:
	return JS.map(events, func(event): return event["signal"])

## it.each([left, right, back, front])
func test_enters_the_same_fixture_magnet_from_each_side() -> void:
	for sample in [
		["left", 7.21, -4],
		["right", 12.79, -4],
		["back", 10, -5.79],
		["front", 10, -2.21],
	]:
		var zone := InteractionZoneState.new(_fixture_zone())
		assert_eq(_signals(zone.update("player", sample[1], sample[2], 0)), ["enter", "tick"], sample[0])

func test_uses_a_rounded_perimeter_and_preserves_exit_hysteresis_around_the_footprint() -> void:
	var zone := InteractionZoneState.new(_fixture_zone())

	assert_eq(_signals(zone.update("player", 12.5, -4.5, 0)), ["enter", "tick"])
	assert_false(JS.some(zone.update("player", 12.9, -4.5, 20), func(event): return event["signal"] == "exit"))
	assert_eq(_signals(zone.update("player", 13.01, -5.01, 40)), ["exit"])

func test_builds_a_physical_compound_sensor_equal_to_the_logical_rounded_rectangle() -> void:
	var config := _fixture_zone()
	var primitives := InteractionZone.interaction_zone_sensor_primitives(config)
	var physical_contains := func(x: float, z: float) -> bool:
		return JS.some(primitives, func(primitive):
			var local_x: float = x - config.x
			var local_z: float = z - config.z
			if primitive.kind == "box":
				return absf(local_x) <= primitive.halfX and absf(local_z) <= primitive.halfZ
			return JS.hypot(local_x - primitive.offsetX, local_z - primitive.offsetZ) <= primitive.radius)

	for point in [
		[10, -4],
		[12.79, -4],
		[10, -2.21],
		[12.55, -2.45],
		[12.6, -2.4],
		[13, -5],
	]:
		assert_eq(physical_contains.call(point[0], point[1]), InteractionZone.interaction_zone_planar_distance(config, point[0], point[1]) <= config.enterRadius, "%s,%s" % [point[0], point[1]])
