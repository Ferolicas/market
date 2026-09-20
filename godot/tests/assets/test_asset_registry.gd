extends TestCase
const Registry = preload("res://game/assets/asset_registry.gd")

func test_original_inventory_and_unique_identifiers() -> void:
	assert_eq(Registry.EXPOSURE_ASSET_IDS.size(), 14)
	assert_eq(Registry.EQUIPMENT_ASSET_IDS.size(), 22)
	assert_eq(Registry.FARM_ASSET_IDS.size(), 25)
	assert_eq(Registry.ASSET_REGISTRY.size(), Registry.MARKET_ASSETS.size())

func test_every_approved_glb_loads_and_instantiates_in_godot() -> void:
	for asset in Registry.MARKET_ASSETS:
		assert_eq(asset.status, "approved", asset.id)
		assert_gt(asset.referenceImages.size(), 0, asset.id)
		for reference in asset.referenceImages: assert_true(reference.begins_with(Registry.MARKET_REFERENCE_ROOT + "/"))
		assert_true(ResourceLoader.exists(Registry.resource_path(asset.id)), asset.id)
		var instance = Registry.instantiate_asset(asset.id)
		assert_not_null(instance, asset.id)
		if instance != null: instance.free()

func test_unknown_identifier_reports_exact_domain_error() -> void:
	assert_null(assert_engine_error("UNKNOWN_MARKET_ASSET:missing", func(): return Registry.market_asset("missing")))
