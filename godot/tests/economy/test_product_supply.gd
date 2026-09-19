extends TestCase
## Port of src/game/economy/ProductSupply.test.ts (engine-free cases).
## The cases needing MarketEngine live in test_product_supply_engine.gd.

func test_retains_every_registered_product_in_supply_retail_demand_and_the_purchase_campaign() -> void:
	var supply_keys := ProductSupply.PRODUCT_SUPPLY.keys(); supply_keys.sort()
	var product_ids := ProductRegistry.PRODUCT_IDS.duplicate(); product_ids.sort()
	assert_eq(supply_keys, product_ids)
	var unlocked := Objectives.unlocked_customer_products(30); unlocked.sort()
	var expected := JS.filter(ProductRegistry.PRODUCT_IDS, func(id): return ProductSupply.PRODUCT_SUPPLY[id]["legacyLevel"] <= 30); expected.sort()
	assert_eq(unlocked, expected)
	var campaign := MartCampaign.collect_opening_register(MartCampaign.credit_opening_register(MartCampaign.create_opening_campaign(), 10000000))
	for purchase in MartCampaign.OPENING_PURCHASES: campaign = MartCampaign.fund_opening_purchase(campaign, purchase["id"], "ES", 10000000)
	var available := MartCampaign.campaign_available_products(campaign); available.sort()
	assert_eq(available, product_ids)

func test_each_product_has_an_accessible_source_before_customer_demand_supplier_and_unlock_parts() -> void:
	for product in ProductRegistry.PRODUCT_IDS:
		var route: Dictionary = ProductSupply.PRODUCT_SUPPLY[product]
		if route["kind"] == "supplier":
			var supplier = JS.find(Catalog.SUPPLIERS, func(candidate): return candidate["id"] == route["supplierId"])
			assert_lte(supplier["unlockLevel"], route["legacyLevel"], product)
			assert_eq(Catalog.PRODUCTS[product]["supplier"], supplier["id"])
		assert_contains(Objectives.unlocked_customer_products(route["legacyLevel"]), product)
		if route["legacyLevel"] > 1: assert_false(Objectives.unlocked_customer_products(route["legacyLevel"] - 1).has(product), product)

func test_never_offers_a_transformed_product_before_the_ingredient_purchase_paths() -> void:
	for product in ProductRegistry.PRODUCT_IDS:
		var ancestors := {}
		var visit := func(id: String, self_ref: Callable) -> void:
			if ancestors.has(id): return
			ancestors[id] = true
			for dependency in MartCampaign.find_purchase(id)["requires"]: self_ref.call(dependency, self_ref)
		for required in MartCampaign.CAMPAIGN_PRODUCT_REQUIREMENTS[product]: visit.call(required, visit)
		for ingredient in Products.recipe_of(product):
			for required in MartCampaign.CAMPAIGN_PRODUCT_REQUIREMENTS[ingredient]: assert_true(ancestors.has(required), "%s needs %s" % [product, ingredient])
