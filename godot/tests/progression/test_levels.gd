extends TestCase
## Port of src/game/progression/levels.test.ts

func test_defines_every_level_from_1_through_30() -> void:
	assert_eq(Levels.LEVELS.size(), 30)
	assert_eq(JS.map(Levels.LEVELS, func(level): return level["level"]), range(1, 31))
	assert_eq(Levels.LEVELS[29]["costMinor"], 7500000)
	assert_true(JS.every(Levels.LEVELS, func(level): return JS.is_safe_integer(level["costMinor"]) and level["costMinor"] >= 0))
	for index in range(1, Levels.LEVELS.size()): assert_gt(Levels.LEVELS[index]["costMinor"], Levels.LEVELS[index - 1]["costMinor"])

func test_separates_money_earned_from_money_explicitly_assigned_to_construction() -> void:
	assert_eq(Levels.build_funding_quote(142431, { "costMinor": 14000, "contributedMinor": 6500, "completed": false }), {
		"costMinor": 14000,
		"contributedMinor": 6500,
		"remainingMinor": 7500,
		"contributionMinor": 7500,
		"completed": false,
	})
	assert_eq(Levels.build_funding_quote(2000, { "costMinor": 14000, "contributedMinor": 6500, "completed": false })["contributionMinor"], 2000)

func test_calculates_tier_bonuses_from_base_without_accumulating_floats() -> void:
	assert_eq(Levels.station_tier_modifiers(1), { "capacity": 1, "speed": 1, "value": 1 })
	assert_eq(Levels.station_tier_modifiers(10), { "capacity": 2, "speed": 2, "value": 1 })
