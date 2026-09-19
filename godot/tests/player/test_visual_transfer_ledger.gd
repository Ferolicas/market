extends TestCase
## Port of src/game/player/VisualTransferLedger.test.ts

var shelves := { "milk": 3, "tomatoes": 0 }
var harvested_crop := {
	"id": "crop-tomatoes-1",
	"productId": "tomatoes",
	"status": "GROWING",
	"plantedAt": 100,
	"readyAt": 200,
	"available": 0,
	"tier": 10,
}

func _transfers(harvest_remaining: int, stock_remaining: int) -> Array:
	return [
		{ "sequence": 1, "kind": "harvest", "cropId": harvested_crop.id, "productId": "tomatoes", "quantity": 7, "remainingQuantity": harvest_remaining, "carryStart": 0, "cropStart": 7 },
		{ "sequence": 2, "kind": "stock", "productId": "milk", "quantity": 3, "remainingQuantity": stock_remaining, "carryStart": 3, "shelfStart": 0 },
	]

func _matches(actual: Dictionary, expected: Dictionary, message := "") -> void:
	for key in expected: assert_eq(actual.get(key), expected[key], "%s %s" % [message, key])

func test_keeps_every_in_flight_unit_at_its_visual_source_and_reveals_only_landed_units() -> void:
	var authoritative_carry := { "capacity": 20, "items": { "tomatoes": 7 } }

	var just_committed := VisualTransferLedger.derive_visual_transfer_presentation(authoritative_carry, [harvested_crop], shelves, _transfers(7, 3))
	assert_eq(just_committed.carry.items, { "milk": 3 })
	assert_eq(just_committed.shelves.milk, 0)
	_matches(just_committed.crops[0], { "status": "READY", "available": 7 })

	var partially_landed := VisualTransferLedger.derive_visual_transfer_presentation(authoritative_carry, [harvested_crop], shelves, _transfers(2, 2))
	assert_eq(partially_landed.carry.items, { "tomatoes": 5, "milk": 2 })
	assert_eq(partially_landed.shelves.milk, 1)
	_matches(partially_landed.crops[0], { "status": "READY", "available": 2 })

	var completed := VisualTransferLedger.derive_visual_transfer_presentation(authoritative_carry, [harvested_crop], shelves, [])
	assert_eq(completed, { "carry": authoritative_carry, "crops": [harvested_crop], "shelves": shelves })

func test_does_not_double_an_event_queued_before_its_authoritative_world_tick() -> void:
	var pre_commit_carry := { "capacity": 20, "items": { "milk": 3 } }
	var ready_crop := JS.spread(harvested_crop, { "status": "READY", "available": 7 })
	var pre_commit_shelves := JS.spread(shelves, { "milk": 0 })

	var presentation := VisualTransferLedger.derive_visual_transfer_presentation(pre_commit_carry, [ready_crop], pre_commit_shelves, _transfers(7, 3))

	assert_true(is_same(presentation.carry, pre_commit_carry))
	assert_eq(presentation.crops[0], ready_crop)
	assert_true(is_same(presentation.shelves, pre_commit_shelves))

func test_applies_overlapping_remainders_additively_without_mutating_authoritative_state() -> void:
	var carry := { "capacity": 20, "items": { "tomatoes": 5 } }
	var crop := JS.spread(harvested_crop, { "status": "READY", "available": 2 })
	var entries := [
		{ "sequence": 3, "kind": "harvest", "cropId": crop.id, "productId": "tomatoes", "quantity": 2, "remainingQuantity": 1, "carryStart": 3, "cropStart": 4 },
		{ "sequence": 4, "kind": "harvest", "cropId": crop.id, "productId": "tomatoes", "quantity": 2, "remainingQuantity": 2, "carryStart": 3, "cropStart": 4 },
	]

	var presentation := VisualTransferLedger.derive_visual_transfer_presentation(carry, [crop], shelves, entries)

	assert_eq(presentation.carry.items.tomatoes, 2)
	assert_eq(presentation.crops[0].available, 5)
	assert_eq(carry.items.tomatoes, 5)
	assert_eq(crop.available, 2)

func test_records_absolute_low_fps_progress_and_removes_only_the_final_remainder() -> void:
	var entries := _transfers(7, 3)
	var one_left := VisualTransferLedger.update_visual_transfer_remaining(entries, 2, 1)
	var complete := VisualTransferLedger.update_visual_transfer_remaining(one_left, 2, 0)

	assert_eq(JS.find(one_left, func(entry): return entry.sequence == 2).remainingQuantity, 1)
	assert_eq(JS.map(complete, func(entry): return entry.sequence), [1])
	assert_eq(entries[1].remainingQuantity, 3)

func test_keeps_every_returned_product_in_the_visible_basket_until_its_flight_lands() -> void:
	var authoritative_carry := { "capacity": 20, "items": {} }
	var entries := [
		{ "sequence": 5, "kind": "return", "productId": "milk", "quantity": 2, "remainingQuantity": 2, "carryStart": 2 },
		{ "sequence": 6, "kind": "return", "productId": "eggs", "quantity": 1, "remainingQuantity": 1, "carryStart": 1 },
	]

	var just_committed := VisualTransferLedger.derive_visual_transfer_presentation(authoritative_carry, [harvested_crop], shelves, entries)
	assert_eq(just_committed.carry.items, { "milk": 2, "eggs": 1 })

	var partially_landed := VisualTransferLedger.derive_visual_transfer_presentation(authoritative_carry, [harvested_crop], shelves, [
		JS.spread(entries[0], { "remainingQuantity": 1 }),
		entries[1],
	])
	assert_eq(partially_landed.carry.items, { "milk": 1, "eggs": 1 })

func test_does_not_duplicate_a_return_queued_before_the_authoritative_world_tick() -> void:
	var pre_commit_carry := { "capacity": 20, "items": { "milk": 2, "eggs": 1 } }
	var entries := [
		{ "sequence": 7, "kind": "return", "productId": "milk", "quantity": 2, "remainingQuantity": 2, "carryStart": 2 },
		{ "sequence": 8, "kind": "return", "productId": "eggs", "quantity": 1, "remainingQuantity": 1, "carryStart": 1 },
	]

	var presentation := VisualTransferLedger.derive_visual_transfer_presentation(pre_commit_carry, [harvested_crop], shelves, entries)

	assert_true(is_same(presentation.carry, pre_commit_carry))
	assert_true(is_same(presentation.shelves, shelves))
