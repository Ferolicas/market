extends TestCase
## Port of src/game/economy/CampaignEconomy.test.ts (needs MarketEngine and SaveAuthority).

func test_starts_without_capital_or_daily_bonuses_in_every_country() -> void:
	for country in Catalog.COUNTRIES:
		var state: Dictionary = MarketEngine.create_campaign_game(country)
		assert_eq(state["balanceMinor"], 0, country)
		assert_eq(state["missions"], [], country)
		state["missions"] = JS.map(MarketEngine.create_initial_game(country)["missions"], func(mission): return JS.spread(mission, { "completed": true }))
		var claim: Dictionary = MarketEngine.apply_game_action(state, { "type": "CLAIM_MISSION", "missionId": state["missions"][0]["id"] })
		assert_false(claim["ok"], country)
		assert_eq(claim["events"], [], country)
		assert_eq(MarketEngine.normalize_game_state(JS.json_clone(state))["missions"], [], country)

func test_keeps_register_cash_personal_work_and_license_through_eight_empty_daily_closures_and_reloads() -> void:
	var state: Dictionary = MarketEngine.create_campaign_game()
	state["balanceMinor"] = 6800
	state = MarketEngine.apply_game_action(state, { "type": "CONTRIBUTE_PURCHASE", "purchaseId": "farmer-1", "amountMinor": 2000 })["state"]
	assert_eq(state["franchises"][0]["employees"].size(), 1)
	state["balanceMinor"] = 0
	state["franchises"][0]["registerCashMinor"] = [100, 200, 300]
	state["franchises"][0]["purchases"]["personalProgress"] = { "player:stock:tomatoes": 3 }
	for day in range(1, 9):
		state["franchises"][0]["open"] = true
		# Revenue in a drawer must never trigger a debit from an empty wallet.
		state["franchises"][0]["revenueTodayMinor"] = 30000
		var result: Dictionary = MarketEngine.apply_game_action(state, { "type": "CLOSE_DAY" })
		assert_true(result["ok"])
		assert_eq(result["state"]["day"], day + 1)
		assert_eq(result["state"]["balanceMinor"], 0)
		assert_eq(result["state"]["franchises"][0]["registerCashMinor"], [100, 200, 300])
		assert_eq(JS.filter(result["events"], func(event): return ["payroll", "operations", "tax"].has(event["category"])), [])
		assert_eq(SaveAuthority.validate_save_transition(state, result["state"], result["events"]), { "ok": true })
		state = MarketEngine.normalize_game_state(JS.json_clone(result["state"]))
		assert_eq(state["franchises"][0]["purchases"]["personalProgress"], { "player:stock:tomatoes": 3 })
		assert_eq(state["missions"], [])
		assert_false(MarketEngine.apply_game_action(state, { "type": "CLOSE_DAY" })["ok"])
	assert_true(MarketEngine.apply_game_action(state, { "type": "TOGGLE_STORE" })["ok"])
	assert_false(MarketEngine.apply_game_action(state, { "type": "BUY_LICENSE" })["ok"])
	assert_eq(state["finances"]["payrollMinor"], 0)
	assert_eq(state["finances"]["operatingCostsMinor"], 0)
	assert_eq(state["finances"]["taxesMinor"], 0)

func test_rejects_a_forged_legacy_reward_event_in_a_campaign_save() -> void:
	var legacy: Dictionary = MarketEngine.create_initial_game()
	legacy["missions"][0]["completed"] = true
	var claimed: Dictionary = MarketEngine.apply_game_action(legacy, { "type": "CLAIM_MISSION", "missionId": legacy["missions"][0]["id"] })
	assert_true(claimed["ok"])
	assert_eq(SaveAuthority.validate_save_transition(legacy, claimed["state"], claimed["events"]), { "ok": true })
	var purchases = MarketEngine.create_campaign_game()["franchises"][0]["purchases"]
	legacy["franchises"][0]["purchases"] = purchases
	claimed["state"]["franchises"][0]["purchases"] = purchases
	assert_false(SaveAuthority.validate_save_transition(legacy, claimed["state"], claimed["events"])["ok"])

func test_preserves_legacy_daily_costs_and_license_countdown() -> void:
	var state: Dictionary = MarketEngine.create_initial_game()
	state["franchises"][0]["open"] = true
	var result: Dictionary = MarketEngine.apply_game_action(state, { "type": "CLOSE_DAY" })
	assert_true(result["ok"])
	assert_eq(result["state"]["balanceMinor"], state["balanceMinor"] - 2600)
	assert_eq(result["state"]["franchises"][0]["licenseDaysLeft"], 6)
	assert_eq(result["state"]["missions"].size(), 3)
	assert_eq(SaveAuthority.validate_save_transition(state, result["state"], result["events"]), { "ok": true })
