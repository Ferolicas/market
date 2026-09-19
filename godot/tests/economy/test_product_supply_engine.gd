extends TestCase
## Port of src/game/economy/ProductSupply.test.ts (cases needing MarketEngine).

func test_each_product_has_an_accessible_source_before_customer_demand() -> void:
	for product in ProductRegistry.PRODUCT_IDS:
		var route: Dictionary = ProductSupply.PRODUCT_SUPPLY[product]
		var initial: Dictionary = MarketEngine.create_initial_game()
		initial["level"] = route["legacyLevel"]
		var state: Dictionary = MarketEngine.normalize_game_state(initial)
		if route["kind"] == "supplier":
			var supplier = JS.find(Catalog.SUPPLIERS, func(candidate): return candidate["id"] == route["supplierId"])
			assert_lte(supplier["unlockLevel"], route["legacyLevel"])
			assert_eq(Catalog.PRODUCTS[product]["supplier"], supplier["id"])
		else:
			var station = JS.find(state["franchises"][0]["crops"], func(crop): return crop["id"] == route["stationId"]) if route["kind"] == "crop" \
				else JS.find(state["franchises"][0]["productionMachines"], func(machine): return machine["id"] == route["stationId"])
			assert_not_null(station, product)
			assert_eq(station["productId"], product)
			assert_ne(station["status"], "LOCKED")
		assert_contains(Objectives.unlocked_customer_products(route["legacyLevel"]), product)
		if route["legacyLevel"] > 1: assert_false(Objectives.unlocked_customer_products(route["legacyLevel"] - 1).has(product))

func test_orders_receives_carries_and_stocks_coffee_once_across_a_reload() -> void:
	var initial: Dictionary = MarketEngine.create_initial_game()
	initial["level"] = 9
	var ordered: Dictionary = MarketEngine.apply_game_action(MarketEngine.normalize_game_state(initial), { "type": "ORDER", "supplierId": "andes", "productId": "coffee", "quantity": 3 })
	assert_true(ordered["ok"])
	var restored: Dictionary = MarketEngine.normalize_game_state(JS.json_clone(ordered["state"]))
	restored["franchises"][0]["open"] = true
	restored["minuteOfDay"] = restored["pendingOrders"][0]["arrivesAtMinute"]
	var delivered: Dictionary = MarketEngine.advance_world(restored, 0)
	assert_eq(delivered["state"]["franchises"][0]["warehouse"]["coffee"], 3)
	assert_eq(delivered["state"]["pendingOrders"], [])
	var repeated: Dictionary = MarketEngine.advance_world(delivered["state"], 0)
	assert_eq(repeated["state"]["franchises"][0]["warehouse"]["coffee"], 3)
	var picked: Dictionary = MarketEngine.apply_game_action(repeated["state"], { "type": "PICKUP_WAREHOUSE", "productId": "coffee", "quantity": 3 })
	assert_true(picked["ok"])
	var stocked: Dictionary = MarketEngine.apply_game_action(picked["state"], { "type": "STOCK", "productId": "coffee", "quantity": 3, "source": "carry" })
	assert_true(stocked["ok"])
	assert_eq(stocked["state"]["franchises"][0]["shelves"]["coffee"], 3)
	assert_eq(JS.get_or(stocked["state"]["franchises"][0]["carry"]["items"], "coffee", 0), 0)

func test_produces_or_harvests_each_product_and_transfers_it_to_its_existing_shelf() -> void:
	for product in JS.filter(ProductRegistry.PRODUCT_IDS, func(id): return ProductSupply.PRODUCT_SUPPLY[id]["kind"] != "supplier"):
		var initial: Dictionary = MarketEngine.create_initial_game()
		initial["level"] = 30
		var state: Dictionary = MarketEngine.normalize_game_state(initial)
		var route: Dictionary = ProductSupply.PRODUCT_SUPPLY[product]
		var initial_shelf: int = state["franchises"][0]["shelves"][product]
		if route["kind"] == "crop":
			var crop = JS.find(state["franchises"][0]["crops"], func(candidate): return candidate["id"] == route["stationId"])
			var remaining: int = crop["readyAt"] - state["simulationTimeMs"]
			while remaining > 0:
				state = MarketEngine.advance_world(state, mini(1000, remaining))["state"]
				remaining -= 1000
			var harvest: Dictionary = MarketEngine.apply_game_action(state, { "type": "HARVEST", "cropId": route["stationId"], "quantity": 1 })
			assert_true(harvest["ok"], product)
			state = harvest["state"]
		else:
			state["franchises"][0]["carry"]["items"] = Products.recipe_of(product).duplicate()
			var load: Dictionary = MarketEngine.apply_game_action(state, { "type": "OPERATE_MACHINE", "machineId": route["stationId"] })
			assert_true(load["ok"], product)
			state = MarketEngine.normalize_game_state(JS.json_clone(load["state"]))
			var machine = JS.find(state["franchises"][0]["productionMachines"], func(candidate): return candidate["id"] == route["stationId"])
			var remaining: int = machine["completesAt"] - state["simulationTimeMs"]
			while remaining > 0:
				state = MarketEngine.advance_world(state, mini(1000, remaining))["state"]
				remaining -= 1000
			var collect: Dictionary = MarketEngine.apply_game_action(state, { "type": "OPERATE_MACHINE", "machineId": route["stationId"] })
			assert_true(collect["ok"], product)
			state = collect["state"]
		var stock: Dictionary = MarketEngine.apply_game_action(state, { "type": "STOCK", "productId": product, "quantity": 1, "source": "carry" })
		assert_true(stock["ok"], product)
		assert_eq(stock["state"]["franchises"][0]["shelves"][product], initial_shelf + 1, product)
		assert_eq(JS.get_or(stock["state"]["franchises"][0]["carry"]["items"], product, 0), 0, product)
