extends TestCase
## Port of src/game/progression/MartCampaign.test.ts

func assert_match(actual: Dictionary, expected: Dictionary, message := "") -> void:
	for key in expected: assert_eq(actual.get(key), expected[key], "%s %s" % [key, message])

func test_starts_with_no_free_cash_tomato_demand_and_two_customers() -> void:
	var state := MartCampaign.create_opening_campaign()
	assert_eq(state["walletMinor"], 0)
	assert_match(MartCampaign.opening_availability(state), { "products": ["tomatoes"], "customerLimit": 2, "tomatoYield": 8, "tomatoSaleMinor": 100, "eggSaleMinor": 200 })
	assert_eq(MartCampaign.opening_player_stats(state), { "capacity": 3, "maximumSpeedRatio": 0.7 })

func test_quotes_each_purchase_at_the_authored_level_price() -> void:
	for case in [
		["farmer-1", 2000], ["egg-display-1", 2500], ["chicken-1", 2000],
		["player-2", 2500], ["tomato-2", 5000], ["farmer-2", 9000],
		["expansion-1", 40000], ["chicken-1-tier-3", 5000], ["tomato-3", 9000],
		["chicken-1-tier-2", 9000], ["farmer-3", 12000], ["juice-machine-1", 200000],
		["corn-canner-1", 180000],
	]:
		assert_eq(MartCampaign.opening_purchase_cost(case[0], "ES"), case[1], case[0])
		assert_true(JS.is_safe_integer(MartCampaign.opening_purchase_cost(case[0], "CO")), case[0])

func test_orders_the_purchases_so_each_one_grants_the_next_level() -> void:
	assert_eq(MartCampaign.OPENING_PURCHASES.size(), 27)
	assert_eq(JS.slice(JS.map(MartCampaign.OPENING_PURCHASES, func(purchase): return purchase["id"]), 0, 7),
		["farmer-1", "egg-display-1", "chicken-1", "player-2", "tomato-2", "farmer-2", "expansion-1"])
	assert_eq(MartCampaign.OPENING_PURCHASE_LEVEL["farmer-1"], 2)
	assert_eq(MartCampaign.OPENING_PURCHASE_LEVEL["corn-canner-1"], 28)
	# Every dependency is bought earlier, so the authored order is playable.
	for index in MartCampaign.OPENING_PURCHASES.size():
		for required in MartCampaign.OPENING_PURCHASES[index]["requires"]:
			assert_lt(MartCampaign.OPENING_PURCHASE_LEVEL[required], index + 2)

func test_keeps_the_tier_three_feeder_behind_its_chicken_without_bypassing_dependencies() -> void:
	assert_false(MartCampaign.opening_purchase_quote(MartCampaign.create_opening_campaign(), "chicken-1-tier-3", "ES")["available"])

func test_has_a_reachable_dependency_graph_through_cows_and_cheese_without_free_purchases() -> void:
	var state := MartCampaign.collect_opening_register(MartCampaign.credit_opening_register(MartCampaign.create_opening_campaign(), 10000000))
	for purchase in MartCampaign.OPENING_PURCHASES:
		assert_true(MartCampaign.opening_purchase_quote(state, purchase["id"], "ES")["available"], purchase["id"])
		assert_gt(MartCampaign.opening_purchase_cost(purchase["id"], "ES"), 0)
		state = MartCampaign.fund_opening_purchase(state, purchase["id"], "ES", 10000000)
	assert_eq(state["purchased"].size(), MartCampaign.OPENING_PURCHASES.size())
	assert_contains(state["purchased"], "cheese-maker-1")
	assert_true(MartCampaign.opening_economy_is_conserved(state))

func test_requires_collecting_till_money_before_funding_any_purchase() -> void:
	var initial := MartCampaign.create_opening_campaign()
	var sold := MartCampaign.credit_opening_register(initial, 3000)
	assert_eq(sold["walletMinor"], 0)
	assert_eq(sold["registerMinor"], 3000)
	assert_eq(MartCampaign.fund_opening_purchase(sold, "farmer-1", "ES", 3000), sold)
	var funded := MartCampaign.fund_opening_purchase(MartCampaign.collect_opening_register(sold), "farmer-1", "ES", 3000)
	assert_eq(MartCampaign.opening_purchase_quote(funded, "farmer-1", "ES")["remainingMinor"], 0)
	assert_true(MartCampaign.opening_economy_is_conserved(funded))
	assert_eq(initial["registerMinor"], 0)

func test_does_not_spend_more_than_the_remaining_cost_or_buy_an_item_twice() -> void:
	var rich := MartCampaign.collect_opening_register(MartCampaign.credit_opening_register(MartCampaign.create_opening_campaign(), 10000))
	var funded := MartCampaign.fund_opening_purchase(rich, "farmer-1", "ES", 10000)
	assert_eq(funded["walletMinor"], 8000)
	assert_eq(funded["purchased"], ["farmer-1"])
	assert_true(is_same(MartCampaign.fund_opening_purchase(funded, "farmer-1", "ES", 10000), funded))
	assert_true(is_same(MartCampaign.collect_opening_register(funded), funded))

func test_persists_exact_partial_funding_without_rounding_or_releasing_the_item() -> void:
	var state := MartCampaign.fund_opening_purchase(MartCampaign.collect_opening_register(MartCampaign.credit_opening_register(MartCampaign.create_opening_campaign(), 1500)), "egg-display-1", "ES", 1500)
	var restored: Dictionary = JS.json_clone(state)
	assert_match(MartCampaign.opening_purchase_quote(restored, "egg-display-1", "ES"), { "contributedMinor": 0, "remainingMinor": 2500, "completed": false })
	assert_true(MartCampaign.opening_economy_is_conserved(restored))

func test_unlocks_eggs_only_after_buying_the_display_and_chicken_then_offers_the_farmer() -> void:
	var state := MartCampaign.collect_opening_register(MartCampaign.credit_opening_register(MartCampaign.create_opening_campaign(), 100000))
	assert_true(is_same(MartCampaign.fund_opening_purchase(state, "chicken-1", "ES", 100000), state))
	state = MartCampaign.fund_opening_purchase(state, "farmer-1", "ES", 100000)
	state = MartCampaign.fund_opening_purchase(state, "egg-display-1", "ES", 100000)
	assert_eq(MartCampaign.opening_availability(state)["products"], ["tomatoes"])
	state = MartCampaign.fund_opening_purchase(state, "chicken-1", "ES", 100000)
	assert_eq(MartCampaign.opening_availability(state)["products"], ["tomatoes", "eggs"])
	assert_true(MartCampaign.opening_availability(state)["expansionAvailable"])
	assert_eq(MartCampaign.opening_availability(state)["customerLimit"], 2)

func test_upgrades_player_capacity_and_speed_together_while_farmer_never_feeds() -> void:
	var state := MartCampaign.collect_opening_register(MartCampaign.credit_opening_register(MartCampaign.create_opening_campaign(), 100000))
	for id in ["farmer-1", "egg-display-1", "chicken-1", "player-2"]: state = MartCampaign.fund_opening_purchase(state, id, "ES", 100000)
	assert_eq(MartCampaign.opening_player_stats(state)["capacity"], 4)
	assert_near(MartCampaign.opening_player_stats(state)["maximumSpeedRatio"], 0.721, 0.005)
	assert_match(MartCampaign.OPENING_FARMER_STATS, { "capacity": 3, "feedsAnimals": false })
	assert_near(MartCampaign.OPENING_FARMER_STATS["maximumPlayerSpeedRatio"], 0.49, 0.005)

func test_rejects_invalid_monetary_pulses() -> void:
	for amount in [NAN, INF, -1, 0.5]:
		var state := MartCampaign.collect_opening_register(MartCampaign.credit_opening_register(MartCampaign.create_opening_campaign(), 10000))
		assert_true(is_same(MartCampaign.credit_opening_register(state, amount), state), str(amount))
		assert_true(is_same(MartCampaign.collect_opening_register(state, amount), state), str(amount))
		assert_true(is_same(MartCampaign.fund_opening_purchase(state, "farmer-1", "ES", amount), state), str(amount))

func test_conserves_every_cent_across_2000_deterministic_mixed_operations_and_reloads() -> void:
	var state := MartCampaign.create_opening_campaign()
	var seed := 54321
	for index in 2000:
		seed = JS.lcg_next(seed)
		var amount := seed % 2000
		if index % 3 == 0: state = MartCampaign.credit_opening_register(state, amount)
		elif index % 3 == 1: state = MartCampaign.collect_opening_register(state, amount)
		else: state = MartCampaign.fund_opening_purchase(state, MartCampaign.OPENING_PURCHASES[seed % MartCampaign.OPENING_PURCHASES.size()]["id"], "ES", amount)
		if index % 11 == 0: state = JS.json_clone(state)
		assert_true(MartCampaign.opening_economy_is_conserved(state), "index %d" % index)
		assert_eq(JS.unique(state["purchased"]).size(), state["purchased"].size())
