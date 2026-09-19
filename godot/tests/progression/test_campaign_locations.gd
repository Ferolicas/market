extends TestCase
## Port of src/game/progression/CampaignLocations.test.ts (engine-free cases).
## The cases needing MarketEngine live in test_campaign_locations_engine.gd.
## `createCampaignGame` fixtures are replaced by minimal franchise dictionaries
## carrying only what campaignMasteryProgress reads (id, purchases, carry).

func assert_match(actual: Dictionary, expected: Dictionary, message := "") -> void:
	for key in expected: assert_eq(actual.get(key), expected[key], "%s %s" % [key, message])

func _franchise(id: String) -> Dictionary:
	return { "id": id, "purchases": PurchaseState.create_purchase_state(), "carry": MarketTypes.create_carry_state() }

func test_measures_whole_store_mastery_including_locked_chains_without_early_100_percent() -> void:
	var store := _franchise("estacion")
	assert_eq(CampaignExpansion.campaign_mastery_progress(store), 0)
	store["purchases"]["personalProgress"] = { "player:harvest:tomatoes": 16, "player:stock:tomatoes": 16 }
	assert_lt(CampaignExpansion.campaign_mastery_progress(store), 10)
	store["purchases"]["purchased"] = JS.map(MartCampaign.OPENING_PURCHASES, func(item): return item["id"])
	store["purchases"]["personalProgress"] = JS.from_entries(JS.map(CampaignTasks.CAMPAIGN_TASK_IDS, func(id): return [id, CampaignTasks.campaign_task_target(id, store["id"])]))
	assert_lt(CampaignExpansion.campaign_mastery_progress(store), 100)
	store["purchases"]["completedContracts"] = JS.map(CampaignContracts.campaign_contracts(store), func(contract): return contract["id"])
	assert_eq(CampaignExpansion.campaign_mastery_progress(store), 100)
	assert_eq(CampaignExpansion.campaign_mastery_progress(_franchise("barrio")), 0)

func test_has_distinct_specialties_with_all_personal_targets_within_the_save_budget() -> void:
	assert_eq(JS.unique(JS.map(CampaignLocations.CAMPAIGN_LOCATIONS.values(), func(profile): return profile["specialty"])).size(), 6)
	for location in CampaignLocations.CAMPAIGN_LOCATIONS:
		for task in CampaignTasks.CAMPAIGN_TASK_IDS:
			var target := CampaignTasks.campaign_task_target(task, location)
			assert_true(JS.is_safe_integer(target))
			assert_gt(target, 0)
			assert_lte(target, 100)
	assert_match(CampaignTasks.campaign_task_status("player:stock:coffee", {}, "estacion"), { "target": 12, "label": "Repón tú 12 cafés" })
	assert_match(CampaignTasks.campaign_task_status("player:harvest:coffee", {}, "estacion"), { "target": 12, "label": "Cosecha tú 12 cafés" })
	assert_eq(CampaignTasks.campaign_task_target("player:stock:juice", "marina"), 16)
	# Construction teaching gates stay short; local mastery is for expansion.
	assert_eq(CampaignTasks.purchase_tasks("flour-mill-1")[0]["target"], 6)

func _units(list: Array) -> int:
	return JS.sum(JS.map(list, func(line): return line["requested"]))

func test_samples_deterministically_without_locked_products_or_duplicated_lines() -> void:
	for location in CampaignLocations.CAMPAIGN_LOCATIONS:
		for seed in range(1, 501):
			var available := ["coffee", "bread", "tomatoes"]
			var list := CampaignLocations.campaign_shopping_list(location, available, seed * 2654435761, 28)
			assert_eq(list, CampaignLocations.campaign_shopping_list(location, available, seed * 2654435761, 28))
			assert_eq(JS.unique(JS.map(list, func(line): return line["productId"])).size(), list.size())
			assert_true(JS.every(list, func(line): return available.has(line["productId"])))
			assert_lte(_units(list), 15)
	assert_eq(CampaignLocations.campaign_shopping_list("megastore", [], 2, 28), [])
	# Before the eggs open only tomatoes are on sale: one unit, sometimes two.
	for seed in range(1, 101):
		var list := CampaignLocations.campaign_shopping_list("megastore", ["tomatoes"], seed, 3)
		assert_eq(list.size(), 1)
		assert_contains([1, 2], list[0]["requested"])

func test_buys_four_units_spread_over_every_product_on_sale_once_the_eggs_open() -> void:
	assert_eq(CampaignLocations.campaign_basket_units(3), { "base": 1, "bonus": 1 })
	assert_eq(CampaignLocations.campaign_basket_units(4), { "base": 4, "bonus": 1 })
	assert_eq(CampaignLocations.campaign_basket_units(7), { "base": 5, "bonus": 1 })
	assert_eq(CampaignLocations.campaign_basket_units(28), { "base": 12, "bonus": 1 })
	for seed in range(1, 301):
		var list := CampaignLocations.campaign_shopping_list("barrio", ["tomatoes", "eggs"], seed * 2654435761, 4)
		assert_contains([4, 5], _units(list))
		# Both products on sale are always in the basket, in any distribution.
		var products := JS.map(list, func(line): return line["productId"]); products.sort()
		assert_eq(products, ["eggs", "tomatoes"])
	for seed in range(1, 301):
		var list := CampaignLocations.campaign_shopping_list("barrio", ["tomatoes", "eggs", "bread", "milk"], seed, 13)
		assert_eq(list.size(), 4)
		assert_contains([7, 8], _units(list))

func test_never_asks_for_more_than_three_units_of_a_product_or_more_than_five_products_whatever_the_level() -> void:
	# Level 7 with two products on sale used to put four or more units on one
	# line, which the save schema refuses and which stopped every save.
	for seed in range(1, 501):
		var list := CampaignLocations.campaign_shopping_list("barrio", ["tomatoes", "eggs"], seed * 2654435761, 7)
		assert_true(JS.every(list, func(line): return line["requested"] >= 1 and line["requested"] <= CustomerBrain.MAX_SHOPPING_LINE_UNITS), "seed %d" % seed)
		assert_contains([5, 6], _units(list))
	for seed in range(1, 501):
		var list := CampaignLocations.campaign_shopping_list("megastore", ProductRegistry.PRODUCT_IDS, seed, 28)
		assert_lte(list.size(), CustomerBrain.MAX_SHOPPING_LINES)
		assert_true(JS.every(list, func(line): return line["requested"] <= CustomerBrain.MAX_SHOPPING_LINE_UNITS))
		assert_lte(_units(list), CustomerBrain.MAX_SHOPPING_LINES * CustomerBrain.MAX_SHOPPING_LINE_UNITS)

func test_adds_one_shopper_every_five_levels_up_to_eight() -> void:
	assert_eq(JS.map([1, 2, 3, 4], func(level): return CampaignLocations.campaign_customer_limit(level)), [2, 2, 2, 2])
	assert_eq(CampaignLocations.campaign_customer_limit(5), 3)
	assert_eq(CampaignLocations.campaign_customer_limit(10), 4)
	assert_eq(CampaignLocations.campaign_customer_limit(15), 5)
	assert_eq(CampaignLocations.campaign_customer_limit(29), 7)
	assert_eq(CampaignLocations.campaign_customer_limit(30), 8)

func test_increases_specialty_demand_while_retaining_every_other_available_product() -> void:
	var counts := {}
	for id in ProductRegistry.PRODUCT_IDS: counts[id] = 0
	for seed in range(1, 4001):
		counts[CampaignLocations.campaign_shopping_list("estacion", ProductRegistry.PRODUCT_IDS, seed * 2654435761, 28)[0]["productId"]] += 1
	assert_true(JS.every(counts.values(), func(count): return count > 0))
	assert_gt(counts["coffee"], counts["tomatoes"] * 2)
	assert_gt(counts["bread"], counts["milk"] * 2)
