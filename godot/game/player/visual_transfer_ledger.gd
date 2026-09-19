class_name VisualTransferLedger
extends RefCounted
## Port of src/game/player/VisualTransferLedger.ts.
## Ledger entry keys: sequence, kind, cropId?, productId?, quantity?,
## remainingQuantity?, carryStart?, cropStart?, shelfStart?.
## Presentation: { carry, crops, shelves }.

static func _non_negative_integer(value: Variant) -> int:
	return maxi(0, JS.floor(float(value))) if JS.is_finite_number(value) else 0

static func _inventory_quantity(inventory: Dictionary, product_id: String) -> int:
	return _non_negative_integer(inventory.get(product_id))

static func _transfer_remaining(entry: Dictionary) -> int:
	return mini(_non_negative_integer(entry.get("quantity")), _non_negative_integer(entry.get("remainingQuantity")))

static func _has(entry: Dictionary, key: String) -> bool:
	return entry.get(key) != null

## Updates one flight ledger entry with an absolute remaining unit count. A
## zero remainder removes the entry, which makes the final landing the single
## point where its presentation overlay disappears. Entries keep any
## component-specific event metadata intact.
static func update_visual_transfer_remaining(entries: Array, sequence: int, remaining_quantity: Variant) -> Array:
	var remaining := _non_negative_integer(remaining_quantity)
	var out := []
	for entry in entries:
		if entry.sequence != sequence:
			out.append(entry)
			continue
		if remaining < 1: continue
		out.append(JS.spread(entry, { "remainingQuantity": mini(_non_negative_integer(entry.get("quantity")), remaining) }))
	return out

static func _authoritative_mutation_is_visible(entry: Dictionary, carry: Dictionary, crops: Array, shelves: Dictionary) -> bool:
	if not entry.get("productId"): return false
	var product_id: String = entry.productId
	var quantity := _non_negative_integer(entry.get("quantity"))
	if entry.kind == "stock":
		var shelf_committed := _has(entry, "shelfStart") \
			and _inventory_quantity(shelves, product_id) >= _non_negative_integer(entry.shelfStart) + quantity
		var carry_committed := _has(entry, "carryStart") \
			and _inventory_quantity(carry.items, product_id) <= maxi(0, _non_negative_integer(entry.carryStart) - quantity)
		return shelf_committed or carry_committed
	if entry.kind == "harvest":
		var crop = JS.find(crops, func(candidate): return candidate.id == entry.cropId) if entry.get("cropId") else null
		var crop_committed: bool = crop != null and _has(entry, "cropStart") \
			and (crop.status != "READY" or crop.available <= maxi(0, _non_negative_integer(entry.cropStart) - quantity))
		var carry_committed := _has(entry, "carryStart") \
			and _inventory_quantity(carry.items, product_id) >= _non_negative_integer(entry.carryStart) + quantity
		return crop_committed or carry_committed
	if entry.kind == "return":
		return _has(entry, "carryStart") \
			and _inventory_quantity(carry.items, product_id) <= maxi(0, _non_negative_integer(entry.carryStart) - quantity)
	return false

## Reconciles immediate authoritative mutations with transfers that are still
## visible in flight. Harvested units enter the displayed basket only as they
## land; stocked units remain displayed in the basket and stay hidden at the
## destination until their corresponding flight lands.
##
## The queued interaction can precede the next authoritative world tick. In
## that brief window its baseline fields keep the unmutated source snapshot as
## is, avoiding a doubled basket or crop before the engine confirms the move.
## When nothing is in flight the very same carry/crops/shelves are returned.
static func derive_visual_transfer_presentation(carry: Dictionary, crops: Array, shelves: Dictionary, entries: Array) -> Dictionary:
	var active := JS.filter(entries, func(entry): return _transfer_remaining(entry) > 0 \
		and (entry.kind == "harvest" or entry.kind == "stock" or entry.kind == "return") \
		and entry.get("productId") \
		and _authoritative_mutation_is_visible(entry, carry, crops, shelves))
	if active.is_empty(): return { "carry": carry, "crops": crops, "shelves": shelves }

	var visual_carry := { "capacity": carry.capacity, "items": carry.items.duplicate() }
	var visual_shelves: Dictionary = shelves.duplicate()
	var visual_crops: Variant = null

	for entry in active:
		var product_id: String = entry.productId
		var remaining := _transfer_remaining(entry)
		if entry.kind == "stock":
			visual_carry.items[product_id] = _inventory_quantity(visual_carry.items, product_id) + remaining
			visual_shelves[product_id] = maxi(0, _inventory_quantity(visual_shelves, product_id) - remaining)
			continue
		if entry.kind == "return":
			visual_carry.items[product_id] = _inventory_quantity(visual_carry.items, product_id) + remaining
			continue

		var carry_quantity := maxi(0, _inventory_quantity(visual_carry.items, product_id) - remaining)
		if carry_quantity > 0: visual_carry.items[product_id] = carry_quantity
		else: visual_carry.items.erase(product_id)
		if not entry.get("cropId"): continue
		if visual_crops == null: visual_crops = JS.map(crops, func(crop): return crop.duplicate())
		var crop = JS.find(visual_crops, func(candidate): return candidate.id == entry.cropId)
		if crop != null:
			crop.available = _non_negative_integer(crop.available) + remaining
			crop.status = "READY"

	return { "carry": visual_carry, "crops": visual_crops if visual_crops != null else crops, "shelves": visual_shelves }
