class_name AssetRegistry
extends RefCounted
## Source metadata stays verbatim. Only resource_path adapts public URLs to res://.
static var DATA: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://game/assets/registry_data.json"))
static var MARKET_ASSETS: Array = DATA.MARKET_ASSETS
static var EXPOSURE_ASSET_IDS: Array = DATA.EXPOSURE_ASSET_IDS
static var EQUIPMENT_ASSET_IDS: Array = DATA.EQUIPMENT_ASSET_IDS
static var FARM_ASSET_IDS: Array = DATA.FARM_ASSET_IDS
static var MARKET_REFERENCE_ROOT: String = DATA.MARKET_REFERENCE_ROOT
static var ASSET_REGISTRY: Dictionary = _index()

static func _index() -> Dictionary:
	var registry := {}
	for asset in MARKET_ASSETS: registry[asset.id] = asset
	return registry

static func market_asset(id: String) -> Variant:
	if not ASSET_REGISTRY.has(id):
		push_error("UNKNOWN_MARKET_ASSET:" + id)
		return null
	return ASSET_REGISTRY[id]

static func resource_path(id: String) -> String:
	var asset = market_asset(id)
	return "" if asset == null else "res://assets" + asset.asset

static func instantiate_asset(id: String) -> Node3D:
	var path := resource_path(id)
	if path.is_empty(): return null
	var scene = load(path)
	if not scene is PackedScene:
		push_error("INVALID_MARKET_ASSET:" + id)
		return null
	return scene.instantiate() as Node3D
