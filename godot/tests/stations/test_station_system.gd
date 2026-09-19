extends TestCase
## Port of src/game/stations/StationSystem.test.ts

func assert_match(actual: Dictionary, expected: Dictionary, message := "") -> void:
	for key in expected:
		if expected[key] is Dictionary and actual.get(key) is Dictionary: assert_match(actual[key], expected[key], "%s.%s" % [message, key])
		else: assert_eq(actual.get(key), expected[key], "%s %s" % [key, message])

func test_replants_automatically_after_the_last_unit_is_harvested() -> void:
	var empty := StationSystem.create_empty_crop("tomato-1", "tomatoes")
	var planted := StationSystem.plant_crop(empty, 1000)
	assert_true(planted["planted"])
	var crop: Dictionary = planted["crop"]
	assert_eq(StationSystem.update_crop(crop, 4999)["status"], "GROWING")
	var ready := StationSystem.update_crop(crop, 5000)
	assert_match(ready, { "status": "READY", "available": 3 })
	var first := StationSystem.harvest_crop(ready, 5100)
	var second := StationSystem.harvest_crop(first["crop"], 5200)
	var third := StationSystem.harvest_crop(second["crop"], 5300)
	assert_match(first, { "harvested": 1, "crop": { "status": "READY", "available": 2 } })
	assert_match(second, { "harvested": 1, "crop": { "status": "READY", "available": 1 } })
	assert_eq(third["harvested"], 1)
	assert_match(third["crop"], { "status": "GROWING", "available": 0, "plantedAt": 5300 })
	assert_eq(third["crop"]["readyAt"], 9300)

func test_yields_three_units_at_tier_one_and_scales_them_with_the_tier_capacity() -> void:
	assert_eq(StationSystem.crop_harvest_yield("tomatoes", 1), 3)
	assert_eq(StationSystem.crop_harvest_yield("tomatoes", 2), 4)
	assert_eq(StationSystem.crop_harvest_yield("wheat", 4), 5)
	assert_eq(StationSystem.crop_harvest_yield("corn", 10), 6)

func test_harvests_an_exact_bounded_batch_and_starts_regrowth_only_on_the_final_unit() -> void:
	var ready := JS.spread(StationSystem.create_crop("batch", "tomatoes", 0), { "status": "READY", "available": 7 })
	var partial := StationSystem.harvest_crop_batch(ready, 5000, 2)
	assert_match(partial, { "harvested": 2, "crop": { "status": "READY", "available": 5 } })
	var emptied := StationSystem.harvest_crop_batch(partial["crop"], 5100, 20)
	assert_eq(emptied["harvested"], 5)
	assert_match(emptied["crop"], { "status": "GROWING", "available": 0, "plantedAt": 5100 })

func test_reduces_growth_time_independently_with_the_plot_tier_and_player_level() -> void:
	var base := StationSystem.crop_growth_duration_ms("tomatoes", 1, 1)
	var by_level := StationSystem.crop_growth_duration_ms("tomatoes", 1, 10)
	var by_tier := StationSystem.crop_growth_duration_ms("tomatoes", 3, 1)
	var combined := StationSystem.crop_growth_duration_ms("tomatoes", 3, 10)
	assert_lt(by_level, base)
	assert_lt(by_tier, base)
	assert_lt(combined, by_level)
	assert_lt(combined, by_tier)
	assert_eq(StationSystem.create_crop("fast-tomato", "tomatoes", 20000, 3, 10)["readyAt"], 20000 + combined)

func test_consumes_recipes_only_on_valid_batch_and_never_loses_full_output() -> void:
	var inventory := ProductRegistry.create_empty_inventory(); inventory["wheat"] = 2
	var loaded := StationSystem.load_machine(StationSystem.create_machine("mill", "flour"), inventory, 2000)
	assert_true(loaded["loaded"])
	assert_eq(loaded["inventory"]["wheat"], 0)
	assert_eq(StationSystem.update_machine(loaded["machine"], 5999)["status"], "PROCESSING")
	var complete := StationSystem.update_machine(loaded["machine"], 6000)
	assert_eq(complete["output"], 1)
	assert_eq(StationSystem.collect_machine_output(complete, 6000)["collected"], 1)

func test_uses_three_cultivated_oranges_not_tomatoes_to_make_one_juice() -> void:
	var inventory := ProductRegistry.create_empty_inventory(); inventory["oranges"] = 3; inventory["tomatoes"] = 2
	var loaded := StationSystem.load_machine(StationSystem.create_machine("juicer", "juice"), inventory, 2000)
	assert_true(loaded["loaded"])
	assert_eq(loaded["inventory"]["oranges"], 0)
	assert_eq(loaded["inventory"]["tomatoes"], 2)
	var complete := StationSystem.update_machine(loaded["machine"], 7000)
	assert_match(complete, { "status": "OUTPUT_READY", "output": 1 })

func test_rejects_a_locked_machine_or_a_full_queue_without_mutating_the_station_or_inventory() -> void:
	var inventory := ProductRegistry.create_empty_inventory(); inventory["wheat"] = 4
	var locked := JS.spread(StationSystem.create_machine("locked-mill", "flour"), { "status": "LOCKED" })
	var locked_inventory: Dictionary = JS.clone(inventory)
	var locked_snapshot: Dictionary = JS.clone(locked)
	var rejected_locked := StationSystem.load_machine(locked, inventory, 2000)
	assert_eq(rejected_locked, { "machine": locked_snapshot, "inventory": locked_inventory, "loaded": false })
	assert_eq(locked, locked_snapshot)
	assert_eq(inventory, locked_inventory)

	var full := JS.spread(StationSystem.create_machine("full-mill", "flour"), { "status": "PROCESSING", "input": { "wheat": 16 }, "startedAt": 1000, "completesAt": 5000 })
	var full_snapshot: Dictionary = JS.clone(full)
	var rejected_full := StationSystem.load_machine(full, inventory, 2000)
	assert_eq(rejected_full, { "machine": full_snapshot, "inventory": locked_inventory, "loaded": false })
	assert_eq(full, full_snapshot)
	assert_eq(inventory, locked_inventory)

func test_queues_a_whole_batch_of_ingredient_and_works_through_it_without_gaps() -> void:
	# Tier 2 mill: output buffer 10, so the queue takes 20 wheat for 10 flours.
	var mill := StationSystem.create_machine("queue-mill", "flour", 2)
	assert_eq(mill["outputCapacity"], 10)
	assert_eq(StationSystem.machine_input_capacity(mill, "wheat"), 20)
	var inventory := ProductRegistry.create_empty_inventory(); inventory["wheat"] = 23
	var loaded := StationSystem.load_machine(mill, inventory, 2000)
	assert_true(loaded["loaded"])
	assert_eq(loaded["inventory"]["wheat"], 3)
	# The first recipe is already in the drum; the rest waits in the queue.
	assert_match(loaded["machine"], { "status": "PROCESSING", "input": { "wheat": 18 }, "completesAt": 5200 })
	assert_eq(StationSystem.machine_queued_cycles(loaded["machine"]), 9)

	var midway := StationSystem.update_machine(loaded["machine"], 2000 + 3200 * 3 + 1)
	assert_match(midway, { "status": "PROCESSING", "output": 3, "input": { "wheat": 12 } })
	assert_eq(midway["completesAt"], 2000 + 3200 * 4)

	var done := StationSystem.update_machine(loaded["machine"], 2000 + 3200 * 10)
	assert_match(done, { "status": "FULL", "output": 10, "input": {} })
	assert_eq(StationSystem.update_machine(done, 100000), done)

func test_holds_the_queue_while_the_buffer_is_full_and_resumes_when_a_unit_is_collected() -> void:
	var mill := StationSystem.create_machine("held-mill", "flour")
	var inventory := ProductRegistry.create_empty_inventory(); inventory["wheat"] = 16
	var loaded: Dictionary = StationSystem.load_machine(mill, inventory, 0)["machine"]
	var full := StationSystem.update_machine(JS.spread(loaded, { "input": { "wheat": 18 } }), 4000 * 8)
	assert_match(full, { "status": "FULL", "output": 8, "input": { "wheat": 4 } })
	var collected := StationSystem.collect_machine_output(full, 40000)
	assert_eq(collected["collected"], 1)
	assert_match(collected["machine"], { "status": "PROCESSING", "output": 7, "input": { "wheat": 2 }, "completesAt": 44000 })
	var emptied := StationSystem.collect_machine_output_batch(collected["machine"], 44000, 20)
	assert_match(emptied, { "collected": 8, "machine": { "status": "PROCESSING", "output": 0, "input": {} } })
	assert_match(StationSystem.update_machine(emptied["machine"], 48000), { "status": "OUTPUT_READY", "output": 1, "input": {} })

func test_collects_machine_output_in_a_bounded_batch_and_preserves_every_remaining_unit() -> void:
	var ready := JS.spread(StationSystem.create_machine("batch-mill", "flour"), { "status": "OUTPUT_READY", "output": 5 })
	var partial := StationSystem.collect_machine_output_batch(ready, 8000, 3)
	assert_match(partial, { "collected": 3, "machine": { "status": "OUTPUT_READY", "output": 2 } })
	var emptied := StationSystem.collect_machine_output_batch(partial["machine"], 8100, 20)
	assert_match(emptied, { "collected": 2, "machine": { "status": "WAITING_INPUT", "output": 0 } })
	assert_eq(partial["collected"] + partial["machine"]["output"], ready["output"])

func test_feeds_and_collects_animal_stations_through_the_shared_machine_api() -> void:
	var coop := StationSystem.create_machine("chicken-coop-1", "eggs")
	assert_eq(coop["outputCapacity"], 10)
	assert_eq(StationSystem.machine_input_capacity(coop, "tomatoes"), 4)
	assert_eq(StationSystem.machine_input_capacity(coop, "wheat"), 0)
	var inventory := ProductRegistry.create_empty_inventory(); inventory["tomatoes"] = 6
	var loaded := StationSystem.load_machine(coop, inventory, 0)
	assert_true(loaded["loaded"])
	assert_eq(loaded["inventory"]["tomatoes"], 2)
	assert_match(loaded["machine"], { "status": "PROCESSING", "input": { "tomatoes": 3 }, "startedAt": 0, "completesAt": 2000 })
	assert_eq(StationSystem.animal_feed_status(loaded["machine"]), { "capacity": 4, "occupied": 4, "free": 0 })
	assert_eq(StationSystem.machine_input_room(loaded["machine"], "tomatoes"), 0)
	var later := StationSystem.update_machine(loaded["machine"], 8000)
	assert_match(later, { "status": "OUTPUT_READY", "output": 4, "input": { "tomatoes": 0 }, "completesAt": null, "startedAt": null })
	var collected := StationSystem.collect_machine_output(later, 8000)
	assert_eq(collected["collected"], 1)
	assert_eq(collected["machine"]["output"], 3)
	assert_eq(StationSystem.chicken_feed_status(collected["machine"]), StationSystem.animal_feed_status(collected["machine"]))
