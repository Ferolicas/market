extends TestCase
## Port of src/game/economy/ProductRegistry.test.ts (cases needing MarketEngine
## and the save schema, GameValidation.safe_parse_save_payload ← src/lib/game-validation.ts).

func _payload() -> Dictionary:
	return {
		"expectedRevision": 0,
		"operationId": "22222222-2222-4222-8222-222222222222",
		"deviceId": "33333333-3333-4333-8333-333333333333",
		"sessionId": "11111111-1111-4111-8111-111111111111",
		"state": MarketEngine.create_initial_game("ES"), "events": [],
	}

func test_creates_independent_inventories_for_every_owner() -> void:
	var state: Dictionary = MarketEngine.create_initial_game()
	state["franchises"][0]["warehouse"]["tomatoes"] = 8
	assert_eq(state["franchises"][1]["warehouse"]["tomatoes"], 0)
	assert_eq(state["franchises"][0]["returnsBin"]["tomatoes"], 0)

func test_preserves_the_existing_schema_four_save_and_all_quantities() -> void:
	var input := _payload()
	for index in ProductRegistry.PRODUCT_IDS.size():
		input["state"]["franchises"][0]["warehouse"][ProductRegistry.PRODUCT_IDS[index]] = index + 10
	var parsed: Dictionary = GameValidation.parse_save_payload(JS.json_clone(input))
	assert_eq(parsed["state"]["franchises"][0]["warehouse"], input["state"]["franchises"][0]["warehouse"])
	var restored: Dictionary = MarketEngine.normalize_game_state(parsed["state"])
	assert_eq(restored["franchises"][0]["warehouse"], input["state"]["franchises"][0]["warehouse"])
	assert_eq(restored["balanceMinor"], input["state"]["balanceMinor"])
	assert_eq(restored["avatar"], input["state"]["avatar"])

func test_rejects_unknown_or_missing_products_in_each_inventory() -> void:
	for field in ["warehouse", "shelves", "returnsBin"]:
		var extra := _payload()
		extra["state"]["franchises"][0][field]["unregistered-product"] = 5
		assert_false(GameValidation.safe_parse_save_payload(extra)["success"], field)
		var missing := _payload()
		missing["state"]["franchises"][0][field].erase("tomatoes")
		assert_false(GameValidation.safe_parse_save_payload(missing)["success"], field)

func test_rejects_invalid_quantities() -> void:
	for quantity in [-1, 0.5, NAN, INF, 1000001]:
		var input := _payload()
		input["state"]["franchises"][0]["warehouse"]["tomatoes"] = quantity
		assert_false(GameValidation.safe_parse_save_payload(input)["success"], str(quantity))

func test_rejects_unknown_products_in_carried_inventory() -> void:
	var input := _payload()
	input["state"]["franchises"][0]["carry"]["items"]["unregistered-product"] = 1
	assert_false(GameValidation.safe_parse_save_payload(input)["success"])
