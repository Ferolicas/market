class_name MarketPresentation
extends RefCounted
## Port of src/game/render/MarketPresentation.ts.
## FurniturePresentationProps: { shelves, shelfTier, machines, customers, checkoutTransactions,
##   returnsBin, returnedCartCount, lightsOn, dynamicCeilingLights, unlockedAreas }
## FarmPresentationProps: { crops, machines, nowMs, unlockedAreas }

## The authoritative world advances at 10 Hz, but furniture changes only when
## stock, checkout presentation, unlocks, lights or a machine's visible state
## changes. Movement/path fields are intentionally excluded here: customer
## bodies consume those snapshots independently from the furniture.
static func same_furniture_presentation(previous: Dictionary, next: Dictionary) -> bool:
	if previous.returnedCartCount != next.returnedCartCount or previous.shelfTier != next.shelfTier or previous.lightsOn != next.lightsOn or previous.dynamicCeilingLights != next.dynamicCeilingLights: return false
	if not _same_string_list(previous.unlockedAreas, next.unlockedAreas): return false
	if not _same_inventory(previous.shelves, next.shelves) or not _same_inventory(previous.returnsBin, next.returnsBin): return false
	if not _same_machine_presentation(previous.machines, next.machines): return false
	if not _same_customer_fixture_presentation(previous.customers, next.customers): return false
	return _same_checkout_presentation(previous.checkoutTransactions, next.checkoutTransactions)

## Crop growth is authored in five discrete visual stages. Reconcile the farm
## only on a stage/status/inventory transition instead of rebuilding its
## complete tree for every simulation timestamp.
static func same_farm_presentation(previous: Dictionary, next: Dictionary) -> bool:
	if not _same_string_list(previous.unlockedAreas, next.unlockedAreas): return false
	if previous.crops.size() != next.crops.size(): return false
	for index in previous.crops.size():
		var left: Dictionary = previous.crops[index]
		var right: Dictionary = next.crops[index]
		if (
			left.id != right.id
			or left.productId != right.productId
			or left.status != right.status
			or left.available != right.available
			or left.tier != right.tier
			or left.baseYield != right.baseYield
			or crop_presentation_stage(left, previous.nowMs) != crop_presentation_stage(right, next.nowMs)
		): return false
	return _same_farm_machine(previous.machines, next.machines, "chicken-coop-1") \
		and _same_farm_machine(previous.machines, next.machines, "chicken-coop-2") \
		and _same_farm_machine(previous.machines, next.machines, "cow-station-1")

static func crop_presentation_stage(crop: Dictionary, now_ms: int) -> int:
	if crop.status == "READY": return 4
	if crop.status != "GROWING" and crop.status != "HARVESTING": return 0
	var progress: float = 1.0 if crop.status == "HARVESTING" \
		else minf(1.0, maxf(0.0, float(now_ms - crop.plantedAt) / float(maxi(1, crop.readyAt - crop.plantedAt))))
	return maxi(0, mini(3, JS.floor(progress * 4.0)))

static func _same_inventory(previous: Dictionary, next: Dictionary) -> bool:
	return JS.every(ProductRegistry.PRODUCT_IDS, func(product_id): return previous.get(product_id) == next.get(product_id))

static func _same_string_list(previous: Array, next: Array) -> bool:
	if previous.size() != next.size(): return false
	for index in previous.size():
		if previous[index] != next[index]: return false
	return true

static func _same_machine_presentation(previous: Array, next: Array) -> bool:
	if previous.size() != next.size(): return false
	for index in previous.size():
		var machine: Dictionary = previous[index]
		var candidate: Dictionary = next[index]
		if not (machine.id == candidate.id and machine.status == candidate.status and machine.output == candidate.output): return false
	return true

static func _current_product(customer: Dictionary) -> Variant:
	var list: Array = customer.shoppingList
	var line: int = customer.currentLine
	return list[line].productId if (line >= 0 and line < list.size()) else null

static func _same_customer_fixture_presentation(previous: Array, next: Array) -> bool:
	if previous.size() != next.size(): return false
	for index in previous.size():
		var customer: Dictionary = previous[index]
		var candidate: Dictionary = next[index]
		if not (customer.id == candidate.id
			and customer.state == candidate.state
			and customer.get("transactionId") == candidate.get("transactionId")
			and customer.currentLine == candidate.currentLine
			and _current_product(customer) == _current_product(candidate)): return false
	return true

static func _same_checkout_presentation(previous: Array, next: Array) -> bool:
	if previous.size() != next.size(): return false
	for index in previous.size():
		var transaction: Dictionary = previous[index]
		var candidate: Dictionary = next[index]
		if (
			transaction.id != candidate.id
			or transaction.customerId != candidate.customerId
			or transaction.state != candidate.state
			or transaction.checkoutLane != candidate.checkoutLane
			or transaction.updatedAt != candidate.updatedAt
			or transaction.pendingItems.size() != candidate.pendingItems.size()
		): return false
		for line_index in transaction.pendingItems.size():
			var line: Dictionary = transaction.pendingItems[line_index]
			var next_line: Dictionary = candidate.pendingItems[line_index]
			if not (line.productId == next_line.productId
				and line.quantity == next_line.quantity
				and line.loaded == next_line.loaded
				and line.scanned == next_line.scanned
				and line.bagged == next_line.bagged): return false
	return true

static func _same_farm_machine(previous: Array, next: Array, id: String) -> bool:
	var left = JS.find(previous, func(machine): return machine.id == id)
	var right = JS.find(next, func(machine): return machine.id == id)
	var l := _machine_view(left)
	var r := _machine_view(right)
	return l == r

static func _machine_view(machine: Variant) -> Array:
	if machine == null: return [null, null, null, null, null, null]
	var input: Dictionary = machine.get("input", {})
	return [machine.get("status"), machine.get("output"), machine.get("tier"), machine.get("outputCapacity"), input.get("tomatoes"), input.get("wheat")]
