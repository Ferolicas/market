class_name QueueManager
extends RefCounted
## Port of src/game/ai/QueueManager.ts. QueueSlot: { index: int, customerId: String|null }

var _slots: Array = []

func _init(count: int) -> void:
	for index in maxi(1, count): _slots.append({ "index": index, "customerId": null })

func reserve(customer_id: String) -> Variant:
	var existing = JS.find(_slots, func(slot): return slot["customerId"] == customer_id)
	if existing != null: return existing["index"]
	var reversed := _slots.duplicate()
	reversed.reverse()
	var available = JS.find(reversed, func(slot): return slot["customerId"] == null)
	if available == null: return null
	available["customerId"] = customer_id
	return available["index"]

func release(customer_id: String) -> bool:
	var slot = JS.find(_slots, func(candidate): return candidate["customerId"] == customer_id)
	if slot == null: return false
	slot["customerId"] = null
	advance()
	return true

func advance() -> void:
	var occupied := JS.sort_by(JS.filter(_slots, func(slot): return slot["customerId"] != null), func(slot): return slot["index"])
	var customers := JS.map(occupied, func(slot): return slot["customerId"])
	for slot in _slots: slot["customerId"] = null
	for index in customers.size(): _slots[index]["customerId"] = customers[index]

func first() -> Variant:
	return _slots[0]["customerId"]

func position_of(customer_id: String) -> Variant:
	var slot = JS.find(_slots, func(candidate): return candidate["customerId"] == customer_id)
	return slot["index"] if slot != null else null

func snapshot() -> Array:
	return JS.map(_slots, func(slot): return slot.duplicate())
