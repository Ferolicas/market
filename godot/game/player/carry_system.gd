class_name CarrySystem
extends RefCounted
## Port of src/game/player/CarrySystem.ts. A CarryState is
## { "capacity": int, "items": { productId: int } }; inventories are
## Dictionaries productId → quantity. Functions never mutate their inputs.
## Cross-module: RetailLayout.retail_shelf_capacity_for_tier.

const CAPACITY_TIERS = [3, 4, 6, 8, 10]
## Older saves can already carry twenty units; keep their inventory valid.
const MAX_WAREHOUSE_PICKUP_BATCH = 20

## Stable order for a hands-free stockroom pickup. One unit per available SKU
## is taken per round, so a single proximity pass can build a mixed basket
## instead of letting the first warehouse key monopolise all free capacity.
const WAREHOUSE_PICKUP_PRODUCT_ORDER = [
	"wheat", "flour", "bread", "corn", "milk", "eggs", "cheese", "apples", "tomatoes", "oranges", "coffee", "juice", "cannedCorn",
]

static func create_carry_container(tier: int = 0) -> Dictionary:
	return { "capacity": CAPACITY_TIERS[mini(CAPACITY_TIERS.size() - 1, maxi(0, tier))], "items": {} }

static func carry_total(container: Dictionary) -> int:
	var total := 0
	for quantity in container.items.values():
		total += maxi(0, JS.floor(float(JS.get_or({ "q": quantity }, "q", 0))))
	return total

static func carry_quantity(container: Dictionary, product_id: String) -> int:
	return maxi(0, JS.floor(float(JS.get_or(container.items, product_id, 0))))

static func carried_product_ids(container: Dictionary) -> Array:
	var ids := []
	for product_id in container.items:
		var quantity = container.items[product_id]
		if JS.is_finite_number(quantity) and quantity > 0: ids.append(product_id)
	return ids

## Product id or null.
static func primary_carry_product(container: Dictionary) -> Variant:
	var ids := carried_product_ids(container)
	return ids[0] if ids.size() > 0 else null

## Selects the carried product whose display is least full. Shelf upgrades use
## one shared capacity multiplier, so comparing each count against its base
## capacity preserves the exact ordering without copying economy mutations into
## the scene. This prevents an insertion-order item with a full shelf from
## blocking another product that can still be stocked.
## `allowed_products` is null (any) or an Array of product ids. Returns id or null.
static func preferred_stocking_product(container: Dictionary, shelves: Dictionary, shelf_tier: Variant = 1, allowed_products: Variant = null, areas: Array = []) -> Variant:
	var selected: Variant = null
	var selected_fill := INF
	for product_id in carried_product_ids(container):
		if allowed_products != null and not (allowed_products as Array).has(product_id): continue
		var capacity := RetailLayout.retail_shelf_capacity_for_tier(shelf_tier, product_id, areas)
		var quantity = max(0, JS.get_or(shelves, product_id, 0))
		if quantity >= capacity: continue
		var fill := float(quantity) / capacity
		if fill < selected_fill:
			selected = product_id
			selected_fill = fill
	return selected

## Produces one authoritative proximity batch for a single product. The batch
## is clamped against both the basket and the exact tier-adjusted shelf space;
## the same quantity drives the engine mutation and every staggered visual
## unit, so a fast walk-by can unload the department without teleporting or
## creating stock. Returns { productId, quantity } or null.
static func next_stocking_pulse(container: Dictionary, shelves: Dictionary, shelf_tier: Variant = 1, allowed_products: Variant = null, areas: Array = []) -> Variant:
	var product_id = preferred_stocking_product(container, shelves, shelf_tier, allowed_products, areas)
	if product_id == null: return null
	var shelf_capacity := RetailLayout.retail_shelf_capacity_for_tier(shelf_tier, product_id, areas)
	var shelf_quantity := maxi(0, JS.floor(float(JS.get_or(shelves, product_id, 0))))
	var quantity := mini(carry_quantity(container, product_id), maxi(0, shelf_capacity - shelf_quantity))
	return { "productId": product_id, "quantity": quantity } if quantity > 0 else null

## Plans every compatible SKU that one department magnet can accept. Each
## product remains an independent authoritative STOCK action (and therefore an
## independent visual flight), while a single proximity tick can empty a mixed
## basket without asking the player to hunt for product-specific sub-zones.
static func department_stocking_pulses(container: Dictionary, shelves: Dictionary, shelf_tier: Variant = 1, allowed_products: Variant = null, areas: Array = []) -> Array:
	var remaining := { "items": container.items.duplicate() }
	var projected_shelves: Dictionary = shelves.duplicate()
	var pulses := []
	var maximum_pulses := carried_product_ids(container).size()

	while pulses.size() < maximum_pulses:
		var pulse = next_stocking_pulse(remaining, projected_shelves, shelf_tier, allowed_products, areas)
		if pulse == null: break
		pulses.append(pulse)
		var left: int = carry_quantity(remaining, pulse.productId) - pulse.quantity
		if left > 0: remaining.items[pulse.productId] = left
		else: remaining.items.erase(pulse.productId)
		projected_shelves[pulse.productId] = maxi(0, JS.floor(float(JS.get_or(projected_shelves, pulse.productId, 0)))) + pulse.quantity

	return pulses

## Executes the carry side of one shelf transfer.  The engine remains the
## authority for capacity and counters; this helper only guarantees that the
## basket removal and the shelf addition use the same confirmed integer amount.
## Returns { container, shelfQuantity, moved }.
static func transfer_carry_to_shelf(container: Dictionary, product_id: String, shelf_quantity: Variant, shelf_capacity: Variant, requested: Variant = 1) -> Dictionary:
	var safe_shelf_quantity := maxi(0, JS.floor(float(shelf_quantity) if JS.is_finite_number(shelf_quantity) else 0.0))
	var safe_shelf_capacity := maxi(0, JS.floor(float(shelf_capacity) if JS.is_finite_number(shelf_capacity) else 0.0))
	var safe_requested := maxi(0, JS.floor(float(requested) if JS.is_finite_number(requested) else 0.0))
	var removable: int = JS.min_of([carry_quantity(container, product_id), safe_requested, maxi(0, safe_shelf_capacity - safe_shelf_quantity)])
	var removed := remove_from_carry(container, product_id, removable)
	return { "container": removed.container, "shelfQuantity": safe_shelf_quantity + removed.moved, "moved": removed.moved }

## Fast, side-effect-free eligibility check used by the physical stockroom
## sensor. Keeping it beside the transfer prevents the scene from advertising
## or queueing an action that the authoritative mutation must reject.
static func can_pickup_warehouse(warehouse: Dictionary, container: Dictionary, product_id: Variant = null) -> bool:
	if carry_total(container) >= maxi(0, JS.floor(float(container.capacity))): return false
	var candidates: Array = [product_id] if product_id != null else WAREHOUSE_PICKUP_PRODUCT_ORDER
	for candidate in candidates:
		var quantity = JS.get_or(warehouse, candidate, 0)
		if JS.is_finite_number(quantity) and JS.floor(float(quantity)) > 0: return true
	return false

## Moves one capacity-bounded stockroom batch into the player's basket without
## mutating either source. Omitting `product_id` distributes the batch across
## every available SKU in deterministic rounds; specifying it keeps a future
## product selector possible without introducing a second economy transition.
## `requested` null → the free capacity. Returns { warehouse, container, moved, movedByProduct }.
static func transfer_warehouse_to_carry(warehouse: Dictionary, container: Dictionary, requested: Variant = null, product_id: Variant = null) -> Dictionary:
	var free_capacity := maxi(0, JS.floor(float(container.capacity)) - carry_total(container))
	var safe_requested: int
	if requested == null: safe_requested = free_capacity
	else: safe_requested = maxi(0, JS.floor(float(requested))) if JS.is_finite_number(requested) else 0
	var transfer_limit: int = JS.min_of([free_capacity, safe_requested, MAX_WAREHOUSE_PICKUP_BATCH])
	if transfer_limit < 1: return { "warehouse": warehouse, "container": container, "moved": 0, "movedByProduct": {} }

	var candidates: Array = [product_id] if product_id != null else WAREHOUSE_PICKUP_PRODUCT_ORDER
	var next_warehouse: Dictionary = warehouse.duplicate()
	var moved_by_product := {}
	var next_container := container
	var moved := 0

	# The hard batch cap keeps this loop bounded even if a malformed legacy
	# snapshot claims an unrealistic basket capacity.
	while moved < transfer_limit:
		var moved_this_round := 0
		for candidate in candidates:
			if moved >= transfer_limit: break
			var available := maxi(0, JS.floor(float(JS.get_or(next_warehouse, candidate, 0))))
			if available < 1: continue
			var addition := add_to_carry(next_container, candidate, available, 1)
			if addition.moved < 1: continue
			next_container = addition.container
			next_warehouse[candidate] = available - addition.moved
			moved_by_product[candidate] = JS.get_or(moved_by_product, candidate, 0) + addition.moved
			moved += addition.moved
			moved_this_round += addition.moved
		if moved_this_round < 1: break

	return { "warehouse": next_warehouse, "container": next_container, "moved": moved, "movedByProduct": moved_by_product }

## Returns { container, moved }.
static func add_to_carry(container: Dictionary, product_id: String, available: float, requested: float = 1) -> Dictionary:
	if available <= 0 or requested <= 0: return { "container": container, "moved": 0 }
	var moved: int = maxi(0, JS.min_of([JS.floor(available), JS.floor(requested), int(container.capacity) - carry_total(container)]))
	if moved == 0: return { "container": container, "moved": 0 }
	var items: Dictionary = container.items.duplicate()
	items[product_id] = carry_quantity(container, product_id) + moved
	return { "container": JS.spread(container, { "items": items }), "moved": moved }

## Returns { container, moved }.
static func remove_from_carry(container: Dictionary, product_id: String, requested: float = 1) -> Dictionary:
	var current := carry_quantity(container, product_id)
	if current == 0 or requested <= 0: return { "container": container, "moved": 0 }
	var moved := mini(current, JS.floor(requested))
	var items: Dictionary = container.items.duplicate()
	var remaining := current - moved
	if remaining: items[product_id] = remaining
	else: items.erase(product_id)
	return { "container": JS.spread(container, { "items": items }), "moved": moved }
