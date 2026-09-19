extends TestCase

func _customer(id: String, state := "NAVIGATE_TO_PRODUCT") -> Dictionary:
	return { "id": id, "identity": "customer_01", "state": state, "currentLine": 0, "shoppingList": [{ "productId": "tomatoes", "requested": 2, "picked": 0 }],
		"hasCart": true, "hasBag": false, "transactionId": null, "basket": { "tomatoes": 1, "apples": 0 } }

func test_publishes_snapshots_and_keeps_maps_stable_for_a_republished_tick() -> void:
	var a := _customer("customer-1")
	var employee := { "id": "stocker-1", "runtime": { "state": "IDLE", "carry": { "capacity": 4, "items": {} } } }
	LiveActors.publish_live_actors([a], [{ "id": "checkout-1" }], [employee, { "id": "no-runtime" }], 200)
	assert_true(is_same(LiveActors.live_actors.customers["customer-1"], a))
	assert_eq(LiveActors.live_actors.employees.size(), 1)
	assert_eq(LiveActors.live_actors.simulationTimeMs, 200)
	var map_before = LiveActors.live_actors.customers
	LiveActors.publish_live_actors([a], [], [employee], 200)
	assert_true(is_same(LiveActors.live_actors.customers, map_before))
	assert_eq(LiveActors.live_actors.transactions.size(), 1, "same tick keeps the maps")
	LiveActors.publish_live_actors([_customer("customer-1")], [], [employee], 400)
	assert_eq(LiveActors.live_actors.transactions.size(), 0)

func test_presentation_keys_change_only_with_presented_fields() -> void:
	var customer := _customer("customer-1")
	var key := LiveActors.customer_presentation_key(customer, null)
	assert_eq(key, "customer-1/customer_01/NAVIGATE_TO_PRODUCT/0/tomatoes/1/0//tomatoes=1/")
	assert_eq(LiveActors.customer_presentation_key(JS.spread(customer, { "x": 9 }), null), key)
	assert_ne(LiveActors.customer_presentation_key(JS.spread(customer, { "state": "PICK_PRODUCT" }), null), key)
	var transaction := { "id": "checkout-1", "state": "SCANNING", "updatedAt": 10, "pendingItems": [{ "productId": "milk", "quantity": 1, "loaded": 1, "scanned": 0, "bagged": 0 }] }
	assert_contains(LiveActors.customer_presentation_key(customer, transaction), "checkout-1:SCANNING:10:milk1100")
	var employee := { "id": "stocker-1", "role": "stocker", "level": 2, "hat": "cap", "runtime": { "state": "NAVIGATE_PICKUP", "carry": { "capacity": 4, "items": { "apples": 2, "bread": 0 } } } }
	assert_eq(LiveActors.employee_presentation_key(employee), "stocker-1/stocker/2/cap/NAVIGATE_PICKUP/apples=2")
	assert_eq(LiveActors.employee_presentation_key({ "id": "c", "role": "cashier", "level": 1, "hat": "none" }), "c/cashier/1/none//")
