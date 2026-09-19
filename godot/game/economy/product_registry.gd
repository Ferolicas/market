class_name ProductRegistry
extends RefCounted
## Port of src/game/economy/ProductRegistry.ts.

## Persisted identifiers: client, simulation and server must agree on this list.
## Extend only together with catalog, production, presentation and migration.
## Never rename an existing identifier to introduce a different product.
const PRODUCT_IDS := [
	"wheat", "flour", "bread", "corn", "milk", "eggs", "cheese", "apples",
	"tomatoes", "oranges", "coffee", "juice", "cannedCorn",
]

const CROP_PRODUCT_IDS := ["tomatoes", "apples", "oranges", "wheat", "corn", "coffee"]

const MACHINE_PRODUCT_IDS := ["flour", "bread", "cheese", "juice", "eggs", "milk", "cannedCorn"]

static func is_product_id(value: Variant) -> bool:
	return value is String and PRODUCT_IDS.has(value)

static func create_empty_inventory() -> Dictionary:
	var inventory := {}
	for id in PRODUCT_IDS: inventory[id] = 0
	return inventory
