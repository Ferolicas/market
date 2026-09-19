extends TestCase
## Port of src/game/ai/CustomerPatience.test.ts (engine-free part).
## The advanceWorld cases live in test_customer_patience_engine.gd.

func test_gives_new_customers_the_two_minute_allowance() -> void:
	assert_eq(CustomerBrain.create_customer_mind("new", ["tomatoes"], 1, 1)["patienceMs"], CustomerPatience.CUSTOMER_PATIENCE_MS)
	assert_eq(CustomerPatience.CUSTOMER_PATIENCE_MS, 120000)

func test_shows_anger_only_while_walking_to_returns_within_the_reaction_window() -> void:
	var customer := { "angry": true, "state": "NAVIGATE_TO_RETURNS", "stateSince": 1000 }
	assert_true(CustomerPatience.customer_showing_anger(customer, 1000))
	assert_true(CustomerPatience.customer_showing_anger(customer, 2499))
	assert_false(CustomerPatience.customer_showing_anger(customer, 2500))
	assert_false(CustomerPatience.customer_showing_anger(JS.spread(customer, { "angry": false }), 1000))
	assert_false(CustomerPatience.customer_showing_anger(JS.spread(customer, { "state": "EXIT_STORE" }), 1000))
