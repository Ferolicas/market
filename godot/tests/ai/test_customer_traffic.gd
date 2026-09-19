extends TestCase
## Port of src/game/ai/CustomerTraffic.test.ts (engine-free part).
## The advanceWorld cases live in test_customer_traffic_engine.gd.

func test_does_not_grow_an_unbounded_unattended_checkout_queue() -> void:
	var customers := []
	for i in 6: customers.append({ "id": "queued-%d" % i, "state": "WAIT_CHECKOUT" })
	assert_false(CustomerTraffic.campaign_needs_customer(customers, 2))
	customers[0]["state"] = "DESPAWN"
	assert_true(CustomerTraffic.campaign_needs_customer(customers, 2))
	assert_true(CustomerTraffic.campaign_needs_customer([], 2))
	assert_false(CustomerTraffic.campaign_needs_customer([{ "state": "ENTER_STORE" }, { "state": "PICK_PRODUCT" }], 2))

func test_raises_every_identitys_speed_exactly_40_percent() -> void:
	for id in range(1, 7): assert_near(CustomerTraffic.customer_walk_speed(id), (1.2 + id * 0.045) * 1.4)
