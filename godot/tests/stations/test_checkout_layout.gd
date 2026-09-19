extends TestCase
## Port of src/game/stations/checkout-layout.test.ts

## Every area that adds furniture, so the tills are checked in the fullest store.
const FULLY_OPENED_STORE = ["purchase-campaign", "checkout-2", "checkout-3", "expansion-side", "flour-mill", "bread-oven", "cheese-maker", "juice-machine",
	"chicken-coop", "chicken-coop-2", "cow-station", "corn-canner", "preserves-supply", "coffee-supply", "farm-wheat", "egg-display", "dairy-display"]

func test_parks_the_trolley_beside_the_customer_away_from_every_counter() -> void:
	for queue_lane in CheckoutLayout.CHECKOUT_LANE_IDS:
		var lane: Dictionary = CheckoutLayout.CHECKOUT_LANES[queue_lane]
		for state in ["UNLOAD", "WAIT_CHECKOUT", "PAY"]:
			var point = CheckoutLayout.checkout_parked_cart({ "state": state, "queueLane": queue_lane, "queueSlot": 0, "x": lane.customerFront[0], "z": lane.customerFront[1] })
			assert_gt(point[0], lane.customerFront[0] + 0.8)
			assert_lt(point[1], lane.customerFront[1])
			assert_gt(lane.counter[2] - point[1], 1.4)
		assert_null(CheckoutLayout.checkout_parked_cart({ "state": "EXIT_STORE", "queueLane": queue_lane, "queueSlot": null, "x": 0, "z": 8 }))

func test_places_the_cashier_on_the_entrance_side_facing_the_store() -> void:
	for lane in CheckoutLayout.CHECKOUT_LANE_IDS:
		var layout: Dictionary = CheckoutLayout.CHECKOUT_LANES[lane]
		assert_gt(layout.cashierWork[2], layout.counter[2])
		assert_lt(layout.customerFront[1], layout.counter[2])
		assert_lt(absf(layout.customerFront[0] - layout.counter[0]), 1)
		assert_eq(layout.bagPickup[1], layout.customerFront[1])
		assert_eq(CheckoutLayout.checkout_queue_position(1, lane), layout.queueStart)
		assert_lt(CheckoutLayout.checkout_queue_position(1, lane)[0], layout.customerFront[0])
		assert_lt(CheckoutLayout.checkout_queue_position(2, lane)[1], layout.queueStart[1])

		var arrival := CheckoutLayout.checkout_queue_arrival(0, lane)
		var approach: Array = arrival[0]
		var destination: Array = arrival[1]
		assert_eq(destination, layout.customerFront)
		assert_eq(approach[0], destination[0])
		assert_lt(approach[1], destination[1])
	assert_gt(CheckoutLayout.CHECKOUT_CAMERA_POSITION[2], CheckoutLayout.CHECKOUT_LANES[0].cashierWork[2])
	assert_lt(CheckoutLayout.CHECKOUT_CAMERA_TARGET[2], CheckoutLayout.CHECKOUT_LANES[0].counter[2])
	assert_lt(CheckoutLayout.CHECKOUT_CAMERA_TARGET[0], CheckoutLayout.CHECKOUT_LANES[0].counter[0])
	assert_eq(CheckoutLayout.CHECKOUT_CAMERA_FRAME.width, 10)
	assert_eq(CheckoutLayout.CHECKOUT_CAMERA_FRAME.height, 10)

func test_faces_every_stationary_queue_and_payment_pose_toward_its_own_register() -> void:
	var checkout_states := ["QUEUE_WAIT", "UNLOAD", "WAIT_CHECKOUT", "PAY"]
	for lane in CheckoutLayout.CHECKOUT_LANE_IDS:
		for slot in 6:
			var position := CheckoutLayout.checkout_queue_position(slot, lane)
			var counter: Array = CheckoutLayout.CHECKOUT_LANES[lane].counter
			var expected := atan2(counter[0] - position[0], counter[2] - position[1])
			for state in checkout_states:
				assert_near(CheckoutLayout.checkout_customer_facing_yaw({ "state": state, "queueLane": lane }, position), expected, 0.005)

func test_opens_the_tills_in_order_and_falls_back_to_the_first_lane_for_unknown_values() -> void:
	assert_eq(CheckoutLayout.open_checkout_lane_count([]), 1)
	assert_eq(CheckoutLayout.open_checkout_lane_count(["checkout-2"]), 2)
	assert_eq(CheckoutLayout.open_checkout_lane_count(["checkout-3"]), 1)
	assert_eq(CheckoutLayout.open_checkout_lane_count(["checkout-3", "checkout-2"]), 3)
	assert_eq(JS.map(CheckoutLayout.CHECKOUT_LANE_IDS, CheckoutLayout.checkout_area_for_lane), ["checkout-1", "checkout-2", "checkout-3"])
	assert_eq(CheckoutLayout.checkout_lane_of(2), 2)
	assert_eq(CheckoutLayout.checkout_lane_of(null), 0)
	assert_eq(CheckoutLayout.checkout_lane_of(7), 0)

func test_stacks_the_tills_in_one_column_and_keeps_the_third_queue_off_the_drinks_service_point() -> void:
	for lane in CheckoutLayout.CHECKOUT_LANE_IDS:
		assert_eq(CheckoutLayout.CHECKOUT_LANES[lane].counter[0], CheckoutLayout.CHECKOUT_LANES[0].counter[0])
		if lane > 0: assert_near(CheckoutLayout.CHECKOUT_LANES[lane - 1].counter[2] - CheckoutLayout.CHECKOUT_LANES[lane].counter[2], 3, 0.005)
	var drinks: Array = RetailLayout.RETAIL_DEPARTMENTS.drinks.service
	for slot in 6:
		var point := CheckoutLayout.checkout_queue_position(slot, 2)
		assert_gte(JS.hypot(point[0] - drinks[0], point[1] - drinks[1]), 1, "slot %d crowds the drinks shopper" % slot)
		assert_gte(JS.hypot(point[0] - StorefrontLayout.STORE_REAR_DOOR.insideApproach[0], point[1] - StorefrontLayout.STORE_REAR_DOOR.insideApproach[1]), 1, "slot %d blocks the rear door" % slot)

func test_keeps_every_tills_sockets_walkable_and_reachable_in_the_fully_opened_store() -> void:
	# Recast reachability (`ensureStoreNavigation`/`storePathfinder`) is not
	# ported: only the pure walkability checks run until NavigationServer3D
	# backs NavMeshService.store_pathfinder.
	for lane in CheckoutLayout.CHECKOUT_LANE_IDS:
		var layout: Dictionary = CheckoutLayout.CHECKOUT_LANES[lane]
		var cashier_work := [layout.cashierWork[0], layout.cashierWork[2]]
		var sockets := [
			["cashier work", cashier_work], ["customer front", layout.customerFront], ["bag pickup", layout.bagPickup],
		]
		for slot in 3:
			sockets.append(["queue slot %d" % (slot + 1), CheckoutLayout.checkout_queue_position(slot + 1, lane)])
		for socket in sockets:
			assert_true(NavMeshService.is_store_navigation_point(socket[1], FULLY_OPENED_STORE), "lane %d %s sits inside furniture" % [lane, socket[0]])
		# The counter itself is solid for everyone.
		assert_false(NavMeshService.is_store_navigation_point([layout.counter[0], layout.counter[2]], FULLY_OPENED_STORE))

func test_leaves_moving_customers_under_navmesh_heading_control() -> void:
	for state in ["NAVIGATE_TO_QUEUE", "MOVE_QUEUE", "NAVIGATE_TO_BAG"]:
		assert_null(CheckoutLayout.checkout_customer_facing_yaw({ "state": state, "queueLane": 0 }, CheckoutLayout.CHECKOUT_LANES[0].customerFront))

func _transaction(id: String, state: String) -> Dictionary:
	return {
		"id": id, "customerId": id, "pendingItems": [], "paymentMethod": "card", "state": state, "nextUnitIndex": 0,
		"paymentCommitted": state == "COMPLETE", "updatedAt": 0, "lastLoadedAt": 0, "lastScannedAt": 0, "lastBaggedAt": 0, "checkoutLane": 0,
	}

func test_keeps_a_completed_bag_awaiting_handoff_independent_from_the_next_live_checkout() -> void:
	var completed := _transaction("old", "COMPLETE")
	var abandoned := _transaction("abandoned", "ABANDONED")
	var live := _transaction("live", "SCANNING")
	var handoff_customer := { "id": "old", "state": "NAVIGATE_TO_BAG", "transactionId": "old" }
	var transactions := [completed, abandoned, live]

	assert_eq(CheckoutLayout.active_checkout_for_lane(transactions, 0).id, "live")
	assert_null(CheckoutLayout.active_checkout_for_lane([completed, abandoned], 0))
	assert_eq(CheckoutLayout.checkout_handoff_for_lane(transactions, 0, [handoff_customer]).id, "old")
	assert_eq(CheckoutLayout.checkout_handoff_for_lane([completed, abandoned], 0, [JS.spread(handoff_customer, { "state": "TAKE_BAG" })]).id, "old")
	assert_null(CheckoutLayout.checkout_handoff_for_lane([completed, abandoned], 0, [JS.spread(handoff_customer, { "state": "NAVIGATE_TO_CART_RETURN", "transactionId": null })]))
	assert_null(CheckoutLayout.active_checkout_for_lane(transactions, 1))
	assert_null(CheckoutLayout.checkout_handoff_for_lane(transactions, 1, [handoff_customer]))

func test_moves_a_completed_bag_from_the_counter_to_the_customers_hand_without_duplicating_it() -> void:
	var transaction := {
		"id": "handoff", "customerId": "customer", "pendingItems": [], "paymentMethod": "card", "state": "COMPLETE", "nextUnitIndex": 0,
		"paymentCommitted": true, "updatedAt": 10, "lastLoadedAt": 1, "lastScannedAt": 2, "lastBaggedAt": 3, "checkoutLane": 0,
	}
	var customer := { "id": "customer", "state": "NAVIGATE_TO_BAG", "transactionId": "handoff" }

	assert_eq(CheckoutLayout.checkout_bag_location(transaction, [customer]), "counter")
	assert_eq(CheckoutLayout.checkout_bag_location(transaction, [JS.spread(customer, { "state": "TAKE_BAG" })]), "customer")
	assert_null(CheckoutLayout.checkout_bag_location(null, [customer]))
