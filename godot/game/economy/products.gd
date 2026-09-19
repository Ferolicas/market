class_name Products
extends RefCounted
## Port of src/game/economy/products.ts. The zod schema becomes
## `validate_product_config`; PRODUCT_CONFIG is the validated table keyed by id.

## Raw authored configuration, in authored order (products.ts `rawProducts`).
const RAW_PRODUCTS := [
	{ "id": "cannedCorn", "cycleMs": 6000, "yield": 3, "outputCapacity": 9, "recipe": { "corn": 1 } },
	{ "id": "tomatoes", "growMs": 4000, "yield": 1, "saleMinor": 400 },
	{ "id": "apples", "growMs": 5000, "yield": 1 },
	{ "id": "oranges", "growMs": 6500, "yield": 1, "saleMinor": 500 },
	{ "id": "wheat", "growMs": 6000, "yield": 1 },
	{ "id": "corn", "growMs": 7000, "yield": 1, "saleMinor": 700 },
	{ "id": "coffee", "growMs": 6000, "yield": 1 },
	{ "id": "eggs", "cycleMs": 2000, "yield": 1, "saleMinor": 900, "outputCapacity": 10, "recipe": { "tomatoes": 1 } },
	{ "id": "milk", "cycleMs": 6000, "yield": 1, "saleMinor": 1000, "outputCapacity": 10, "recipe": { "wheat": 1 } },
	{ "id": "flour", "cycleMs": 4000, "yield": 1, "recipe": { "wheat": 2 } },
	{ "id": "bread", "cycleMs": 6000, "yield": 1, "saleMinor": 1400, "outputCapacity": 8, "recipe": { "flour": 1 } },
	{ "id": "cheese", "cycleMs": 8000, "yield": 1, "saleMinor": 2600, "outputCapacity": 8, "recipe": { "milk": 2 } },
	{ "id": "juice", "cycleMs": 5000, "yield": 1, "saleMinor": 1100, "outputCapacity": 8, "recipe": { "oranges": 3 } },
]

## ProductConfig: { id: ProductId, growMs?: int>=0, cycleMs?: int>0, yield: int>0, saleMinor?: int>=0,
##   outputCapacity?: int>0 (finished units a production machine buffers before it must be emptied;
##   retail shelf capacity is physical and lives in the retail layout), recipe?: Dictionary<ProductId, int>0> }
static var PRODUCT_CONFIG: Dictionary = _build_config()

static func _build_config() -> Dictionary:
	var out := {}
	for raw in RAW_PRODUCTS:
		var parsed = validate_product_config(raw)
		if parsed == null:
			push_error("Invalid product config: %s" % JSON.stringify(raw))
			continue
		out[parsed.id] = parsed
	return out

static func _is_int(value: Variant) -> bool:
	return JS.is_integer(value)

## The productConfigSchema: returns the normalised config (ints, only known
## keys) or null when the value would fail zod validation.
static func validate_product_config(value: Variant) -> Variant:
	if not (value is Dictionary): return null
	if not ProductRegistry.is_product_id(value.get("id")): return null
	var out := { "id": value["id"] }
	var grow = value.get("growMs")
	if grow != null:
		if not _is_int(grow) or grow < 0: return null
		out["growMs"] = int(grow)
	var cycle = value.get("cycleMs")
	if cycle != null:
		if not _is_int(cycle) or cycle <= 0: return null
		out["cycleMs"] = int(cycle)
	var yield_value = value.get("yield")
	if not _is_int(yield_value) or yield_value <= 0: return null
	out["yield"] = int(yield_value)
	var sale = value.get("saleMinor")
	if sale != null:
		if not _is_int(sale) or sale < 0: return null
		out["saleMinor"] = int(sale)
	var capacity = value.get("outputCapacity")
	if capacity != null:
		if not _is_int(capacity) or capacity <= 0: return null
		out["outputCapacity"] = int(capacity)
	var recipe = value.get("recipe")
	if recipe != null:
		if not (recipe is Dictionary): return null
		var normalised := {}
		for key in recipe:
			if not ProductRegistry.is_product_id(key): return null
			if not _is_int(recipe[key]) or recipe[key] <= 0: return null
			normalised[key] = int(recipe[key])
		out["recipe"] = normalised
	return out

## PRODUCT_CONFIG[id]?.field ?? default
static func config_value(product_id: Variant, key: String, default_value: Variant) -> Variant:
	var config = PRODUCT_CONFIG.get(product_id)
	if config == null: return default_value
	return JS.get_or(config, key, default_value)

static func recipe_of(product_id: Variant) -> Dictionary:
	return config_value(product_id, "recipe", {})
