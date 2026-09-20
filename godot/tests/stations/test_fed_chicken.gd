extends TestCase
## Port of src/game/stations/FedChicken.test.ts

func assert_match(actual: Dictionary, expected: Dictionary, message := "") -> void:
	for key in expected: assert_eq(actual.get(key), expected[key], "%s %s" % [key, message])

func test_does_not_produce_anything_without_feed() -> void:
	assert_eq(FedChicken.advance_fed_chicken(FedChicken.create_fed_chicken(), 1000000)["eggs"], 0)

func test_consumes_four_tomatoes_exactly_once_and_produces_four_eggs_in_eight_seconds() -> void:
	var loaded := FedChicken.feed_chicken(FedChicken.create_fed_chicken(), 4, 0)
	assert_eq(loaded["consumed"], 4)
	assert_eq(loaded["state"]["feed"], 3)
	assert_eq(FedChicken.feed_chicken(loaded["state"], 4, 0)["consumed"], 0)
	assert_eq(FedChicken.advance_fed_chicken(loaded["state"], 1999)["eggs"], 0)
	assert_eq(FedChicken.advance_fed_chicken(loaded["state"], 2000)["eggs"], 1)
	assert_match(FedChicken.advance_fed_chicken(loaded["state"], 8000), { "eggs": 4, "feed": 0, "nextEggAtMs": null })

func test_supports_the_three_unit_starting_basket_without_requiring_an_upgrade_to_feed() -> void:
	var loaded := FedChicken.feed_chicken(FedChicken.create_fed_chicken(), 3, 0)
	assert_eq(loaded["consumed"], 3)
	assert_eq(FedChicken.advance_fed_chicken(loaded["state"], 6000)["eggs"], 3)

func test_collects_an_egg_while_the_next_is_processing_without_cancelling_production() -> void:
	var loaded: Dictionary = FedChicken.feed_chicken(FedChicken.create_fed_chicken(), 4, 0)["state"]
	var collected := FedChicken.collect_chicken_eggs(loaded, 3, 2000)
	assert_eq(collected["collected"], 1)
	assert_eq(collected["state"]["nextEggAtMs"], 4000)
	assert_eq(FedChicken.advance_fed_chicken(collected["state"], 8000)["eggs"], 3)

func test_restores_a_half_finished_feed_cycle_exactly() -> void:
	var loaded: Dictionary = FedChicken.feed_chicken(FedChicken.create_fed_chicken(), 4, 0)["state"]
	var midway := FedChicken.advance_fed_chicken(loaded, 3000)
	var restored: Dictionary = JS.json_clone(midway)
	assert_eq(FedChicken.advance_fed_chicken(restored, 8000), FedChicken.advance_fed_chicken(loaded, 8000))

func test_is_independent_of_tick_frequency_and_never_duplicates_at_the_same_timestamp() -> void:
	var loaded: Dictionary = FedChicken.feed_chicken(FedChicken.create_fed_chicken(), 4, 0)["state"]
	var small_steps := loaded
	for now in range(200, 8001, 200): small_steps = FedChicken.advance_fed_chicken(small_steps, now)
	assert_eq(small_steps, FedChicken.advance_fed_chicken(loaded, 8000))
	assert_eq(FedChicken.advance_fed_chicken(small_steps, 8000), small_steps)

func test_each_tier_adds_25_percent_speed_and_feed_capacity() -> void:
	var tier2 := FedChicken.upgrade_fed_chicken(FedChicken.create_fed_chicken(), 0)
	assert_eq(FedChicken.chicken_feed_capacity(tier2["tier"]), 5)
	assert_eq(FedChicken.advance_fed_chicken(FedChicken.feed_chicken(tier2, 4, 0)["state"], 6400)["eggs"], 4)
	var tier3 := FedChicken.upgrade_fed_chicken(tier2, 0)
	assert_eq(FedChicken.chicken_feed_capacity(tier3["tier"]), 6)
	var loaded := FedChicken.feed_chicken(tier3, 10, 0)
	assert_eq(loaded["consumed"], 6)
	assert_eq(FedChicken.advance_fed_chicken(loaded["state"], 8000)["eggs"], 6)

func test_upgrades_preserve_the_current_cycle_deadline() -> void:
	var loaded: Dictionary = FedChicken.feed_chicken(FedChicken.create_fed_chicken(), 4, 0)["state"]
	var upgraded := FedChicken.upgrade_fed_chicken(loaded, 1000)
	assert_eq(upgraded["nextEggAtMs"], 2000)
	assert_eq(FedChicken.advance_fed_chicken(upgraded, 6800)["eggs"], 4)

func test_stops_with_full_output_preserves_unused_feed_and_resumes_on_collection() -> void:
	var first := FedChicken.advance_fed_chicken(FedChicken.feed_chicken(FedChicken.create_fed_chicken(), 4, 0)["state"], 8000)
	var full := FedChicken.advance_fed_chicken(FedChicken.feed_chicken(first, 4, 8000)["state"], 16000)
	var queued: Dictionary = FedChicken.feed_chicken(full, 4, 16000)["state"]
	assert_match(FedChicken.advance_fed_chicken(queued, 100000), { "eggs": 8, "feed": 4, "nextEggAtMs": null })
	var collected := FedChicken.collect_chicken_eggs(queued, 3, 100000)
	assert_eq(collected["collected"], 3)
	assert_eq(collected["state"]["nextEggAtMs"], 102000)
	assert_match(FedChicken.advance_fed_chicken(collected["state"], 106000), { "eggs": 8, "feed": 1, "nextEggAtMs": null })

func test_rejects_invalid_simulation_timestamps() -> void:
	for time in [NAN, INF, -1, 0.5]:
		var initial: Variant = FedChicken.create_fed_chicken()
		assert_eq(FedChicken.feed_chicken(initial, 4, time)["consumed"], 0, str(time))
		assert_eq(FedChicken.collect_chicken_eggs(initial, 3, time)["collected"], 0, str(time))
		assert_eq(FedChicken.upgrade_fed_chicken(initial, time), initial, str(time))
		assert_true(is_same(FedChicken.advance_fed_chicken(initial, time), initial), str(time))
	assert_null(assert_engine_error("Invalid simulation time", func(): return FedChicken.create_fed_chicken(-1)))
