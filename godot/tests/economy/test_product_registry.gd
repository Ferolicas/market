extends TestCase
## Port of src/game/economy/ProductRegistry.test.ts (engine-free cases).
## The cases needing MarketEngine / the save schema live in test_product_registry_engine.gd.

func test_keeps_each_catalog_identifier_unique_and_represented_in_empty_stock() -> void:
	assert_eq(JS.unique(ProductRegistry.PRODUCT_IDS).size(), ProductRegistry.PRODUCT_IDS.size())
	assert_eq(Catalog.PRODUCTS.keys(), ProductRegistry.PRODUCT_IDS)
	assert_eq(ProductRegistry.create_empty_inventory().keys(), ProductRegistry.PRODUCT_IDS)
	assert_true(JS.every(ProductRegistry.create_empty_inventory().values(), func(value): return value == 0))

func test_creates_independent_inventories_for_every_owner() -> void:
	var first := ProductRegistry.create_empty_inventory()
	var second := ProductRegistry.create_empty_inventory()
	first["tomatoes"] = 8
	assert_eq(second["tomatoes"], 0)

func test_has_configuration_for_every_crop_and_production_output() -> void:
	for id in ProductRegistry.CROP_PRODUCT_IDS: assert_gt(Products.config_value(id, "growMs", 0), 0, id)
	for id in ProductRegistry.MACHINE_PRODUCT_IDS: assert_gt(Products.config_value(id, "cycleMs", 0), 0, id)
	for config in Products.PRODUCT_CONFIG.values():
		for id in JS.get_or(config, "recipe", {}): assert_true(ProductRegistry.is_product_id(id), id)

func test_validates_every_authored_product_through_the_schema() -> void:
	for raw in Products.RAW_PRODUCTS:
		assert_eq(Products.validate_product_config(raw), raw, raw["id"])
	assert_eq(Products.PRODUCT_CONFIG.size(), Products.RAW_PRODUCTS.size())
	assert_null(Products.validate_product_config({ "id": "ghost", "yield": 1 }))
	assert_null(Products.validate_product_config({ "id": "wheat", "yield": 0 }))
	assert_null(Products.validate_product_config({ "id": "wheat", "yield": 1, "cycleMs": 0 }))
	assert_null(Products.validate_product_config({ "id": "wheat", "yield": 1, "growMs": -1 }))
	assert_null(Products.validate_product_config({ "id": "wheat", "yield": 1.5 }))
	assert_null(Products.validate_product_config({ "id": "wheat", "yield": 1, "recipe": { "ghost": 1 } }))
	assert_null(Products.validate_product_config({ "id": "wheat", "yield": 1, "recipe": { "corn": 0 } }))

func test_does_not_recognize_a_non_product() -> void:
	for id in ["constructor", "__proto__", "", null, 1]:
		assert_false(ProductRegistry.is_product_id(id), str(id))
