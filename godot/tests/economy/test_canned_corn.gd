extends TestCase
## Port of src/game/economy/CannedCorn.test.ts (needs MarketEngine, SaveAuthority,
## RetailLayout, NavMeshService, WorldScale and ProductionLayout).

func _prepared() -> Dictionary:
	var state: Dictionary = MarketEngine.create_campaign_game()
	state["balanceMinor"] = 10000000
	state["franchises"][0]["purchases"]["personalProgress"] = JS.from_entries(JS.map(CampaignTasks.CAMPAIGN_TASK_IDS, func(id): return [id, CampaignTasks.campaign_task_target(id)]))
	for purchase in MartCampaign.OPENING_PURCHASES:
		var result: Dictionary = MarketEngine.apply_game_action(state, { "type": "CONTRIBUTE_PURCHASE", "purchaseId": purchase["id"], "amountMinor": 10000000 })
		assert_true(result["ok"])
		assert_eq(SaveAuthority.validate_save_transition(state, result["state"], result["events"]), { "ok": true })
		state = result["state"]
	# Isolate supplier flow from employees moving stock during the delivery tick.
	state["franchises"][0]["employees"] = []
	return state

func _overlaps(a: Dictionary, b: Dictionary) -> bool:
	return absf(a["x"] - b["x"]) < a["halfX"] + b["halfX"] and absf(a["z"] - b["z"]) < a["halfZ"] + b["halfZ"]

func test_lets_an_operator_fetch_warehouse_corn_produce_and_return_cans_without_waiting_for_farmers() -> void:
	var state := _prepared()
	var franchise: Dictionary = state["franchises"][0]
	franchise["productionMachines"] = JS.filter(franchise["productionMachines"], func(item): return item["id"] == "corn-canner-1")
	franchise["warehouse"]["corn"] = 1
	franchise["crops"] = []
	franchise["shelves"]["corn"] = MarketEngine.shelf_capacity_for_tier(1, "corn", franchise["unlockedAreas"])
	franchise["shelves"]["cannedCorn"] = MarketEngine.shelf_capacity_for_tier(1, "cannedCorn", franchise["unlockedAreas"])
	franchise["employees"] = [{ "id": "canner-operator", "name": "Luna", "role": "operator", "level": 1, "salaryMinor": 0, "energy": 100, "hat": "frog" }]
	NavMeshService.ensure_store_navigation(91225, franchise["unlockedAreas"])
	var tick := 0
	while tick < 240 and state["franchises"][0]["warehouse"]["cannedCorn"] < 3:
		state = MarketEngine.advance_world(state, 1000, Callable(NavMeshService, "store_pathfinder"))["state"]
		tick += 1
	assert_eq(state["franchises"][0]["warehouse"]["corn"], 0)
	assert_eq(state["franchises"][0]["warehouse"]["cannedCorn"], 3)

func test_converts_one_carried_corn_into_three_cans_survives_mid_cycle_reload_and_never_duplicates_a_batch() -> void:
	var state := _prepared()
	state["franchises"][0]["warehouse"]["corn"] = 1
	var pickup: Dictionary = MarketEngine.apply_game_action(state, { "type": "PICKUP_WAREHOUSE", "productId": "corn", "quantity": 1 })
	var loaded: Dictionary = MarketEngine.apply_game_action(pickup["state"], { "type": "OPERATE_MACHINE", "machineId": "corn-canner-1" })
	assert_true(loaded["ok"])
	assert_eq(JS.get_or(loaded["state"]["franchises"][0]["carry"]["items"], "corn", 0), 0)
	assert_eq(SaveAuthority.validate_save_transition(state, loaded["state"], pickup["events"] + loaded["events"]), { "ok": true })
	assert_false(MarketEngine.apply_game_action(loaded["state"], { "type": "OPERATE_MACHINE", "machineId": "corn-canner-1" })["ok"])
	state = MarketEngine.normalize_game_state(JS.json_clone(loaded["state"]))
	for tick in 6: state = MarketEngine.advance_world(state, 1000)["state"]
	var machine = JS.find(state["franchises"][0]["productionMachines"], func(item): return item["id"] == "corn-canner-1")
	assert_eq(machine["output"], 3)
	var collected: Dictionary = MarketEngine.apply_game_action(state, { "type": "OPERATE_MACHINE", "machineId": machine["id"] })
	assert_true(collected["ok"])
	assert_eq(collected["state"]["franchises"][0]["carry"]["items"]["cannedCorn"], 3)
	assert_eq(SaveAuthority.validate_save_transition(state, collected["state"], collected["events"]), { "ok": true })
	var duplicate: Dictionary = MarketEngine.apply_game_action(MarketEngine.normalize_game_state(JS.json_clone(collected["state"])), { "type": "OPERATE_MACHINE", "machineId": machine["id"] })
	assert_false(duplicate["ok"])
	assert_eq(duplicate["state"]["franchises"][0]["carry"]["items"]["cannedCorn"], 3)

func test_connects_the_new_canner_to_the_warehouse_without_overlapping_fixtures() -> void:
	var state := _prepared()
	var areas: Array = state["franchises"][0]["unlockedAreas"]
	var obstacles: Array = WorldScale.store_obstacles_for_areas(areas)
	var fixture = JS.find(obstacles, func(item): return item.get("id") == "fixture:corn-canner")
	for other in JS.filter(obstacles, func(item): return not is_same(item, fixture)):
		assert_false(_overlaps(other, fixture), str(other.get("id")))
	NavMeshService.ensure_store_navigation(91224, areas)
	var point: Array = ProductionLayout.production_fixture_for_workstation("canner")["operatorWorkPoint"]
	var route: Array = NavMeshService.store_pathfinder([0.9, -5.2], point.duplicate())
	assert_gt(route.size(), 0)
	assert_lt(JS.hypot(JS.at(route, -1)[0] - point[0], JS.at(route, -1)[1] - point[1]), 0.3)

func test_keeps_fresh_corn_distinct_and_forbids_ordering_preserves_before_purchase_or_in_legacy_play() -> void:
	var state: Dictionary = MarketEngine.create_campaign_game()
	assert_false(MarketEngine.can_order_product(state, "cannedCorn"))
	assert_false(MarketEngine.can_order_product(MarketEngine.create_initial_game(), "cannedCorn"))
	assert_false(MartCampaign.campaign_available_products(state["franchises"][0]["purchases"]).has("cannedCorn"))
	assert_false(MarketEngine.apply_game_action(state, { "type": "ORDER", "supplierId": "campo", "productId": "cannedCorn", "quantity": 3 })["ok"])
	var opened := _prepared()
	var available := MartCampaign.campaign_available_products(opened["franchises"][0]["purchases"])
	assert_true(available.has("corn") and available.has("cannedCorn"))

func test_orders_receives_once_carries_stocks_and_reloads_without_changing_fresh_corn() -> void:
	var initial := _prepared()
	initial["franchises"][0]["warehouse"]["corn"] = 7
	var order: Dictionary = MarketEngine.apply_game_action(initial, { "type": "ORDER", "supplierId": "campo", "productId": "cannedCorn", "quantity": 3 })
	assert_true(order["ok"])
	assert_eq(order["state"]["balanceMinor"], initial["balanceMinor"] - 480)
	assert_eq(SaveAuthority.validate_save_transition(initial, order["state"], order["events"]), { "ok": true })
	var restored: Dictionary = MarketEngine.normalize_game_state(JS.json_clone(order["state"]))
	restored["franchises"][0]["open"] = true
	restored["minuteOfDay"] = restored["pendingOrders"][0]["arrivesAtMinute"]
	var delivered: Dictionary = MarketEngine.advance_world(restored, 0)
	assert_eq(delivered["state"]["franchises"][0]["warehouse"]["cannedCorn"], 3)
	assert_eq(delivered["state"]["pendingOrders"], [])
	var repeated: Dictionary = MarketEngine.advance_world(delivered["state"], 0)
	assert_eq(repeated["state"]["franchises"][0]["warehouse"]["cannedCorn"], 3)
	var picked: Dictionary = MarketEngine.apply_game_action(repeated["state"], { "type": "PICKUP_WAREHOUSE", "productId": "cannedCorn", "quantity": 3 })
	var stocked: Dictionary = MarketEngine.apply_game_action(picked["state"], { "type": "STOCK", "productId": "cannedCorn", "quantity": 3, "source": "carry" })
	assert_true(picked["ok"] and stocked["ok"])
	assert_eq(SaveAuthority.validate_save_transition(repeated["state"], stocked["state"], picked["events"] + stocked["events"]), { "ok": true })
	var final_state: Dictionary = MarketEngine.normalize_game_state(JS.json_clone(stocked["state"]))
	assert_eq(final_state["franchises"][0]["shelves"]["cannedCorn"], 3)
	assert_eq(final_state["franchises"][0]["warehouse"]["cannedCorn"], 0)
	assert_eq(JS.get_or(final_state["franchises"][0]["carry"]["items"], "cannedCorn", 0), 0)
	assert_eq(final_state["franchises"][0]["warehouse"]["corn"], 7)
	assert_eq(MarketEngine.shelf_capacity_for_tier(1, "cannedCorn", final_state["franchises"][0]["unlockedAreas"]), 40)

func test_adds_a_non_overlapping_fixture_and_keeps_routes_from_warehouse_and_checkout_open() -> void:
	var state := _prepared()
	var areas: Array = state["franchises"][0]["unlockedAreas"]
	var obstacles: Array = WorldScale.store_obstacles_for_areas(areas)
	var fixture = JS.find(obstacles, func(item): return item.get("id") == "fixture:retail-preserves-1")
	for other in JS.filter(obstacles, func(item): return not is_same(item, fixture)):
		assert_false(_overlaps(other, fixture), str(other.get("id")))
	assert_true(NavMeshService.ensure_store_navigation(91223, areas))
	var destination: Array = RetailLayout.retail_service_point("cannedCorn")
	assert_true(NavMeshService.is_store_navigation_point(destination, areas))
	assert_false(NavMeshService.is_store_navigation_point([fixture["x"] / WorldScale.STORE_LAYOUT_SCALE, fixture["z"] / WorldScale.STORE_LAYOUT_SCALE], areas))
	for start in [[0.9, -5.2], [0, 6.25], [7, 2]]:
		var route: Array = NavMeshService.store_pathfinder(start, destination)
		assert_gt(route.size(), 0)
		assert_lt(JS.hypot(JS.at(route, -1)[0] - destination[0], JS.at(route, -1)[1] - destination[1]), 0.3)
