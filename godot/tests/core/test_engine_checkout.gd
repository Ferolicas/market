extends TestCase
const Checkout = preload("res://game/core/engine_checkout.gd")
const Paths = preload("res://game/core/engine_paths.gd")

func _oracle() -> Dictionary:
	return JSON.parse_string(FileAccess.get_file_as_bytes("res://tests/fixtures/checkout-oracles.json.gz").decompress_dynamic(128 * 1024 * 1024, FileAccess.COMPRESSION_GZIP).get_string_from_utf8())

func test_checkout_trace_and_money_match_typescript_in_all_countries_and_lanes() -> void:
	for scenario in _oracle().sales:
		var state: Dictionary = scenario.before.duplicate(true)
		var franchise: Dictionary = state.franchises[0]
		var transaction: Dictionary = franchise.checkoutTransactions[0]
		var customer: Dictionary = franchise.customers[0]
		var events: Array = []
		for step in scenario.trace:
			state.simulationTimeMs = step.time
			assert_eq(Checkout.can_process_checkout_unit(state, franchise), step.canScan)
			assert_eq(Checkout.process_checkout_unit(state, franchise, transaction, events), step.message)
			Checkout.update_checkout_transactions(state, franchise, events)
			assert_eq(transaction, step.transaction, "checkout at %d ms" % step.time)
			assert_eq(customer, step.customer, "customer at %d ms" % step.time)
		Checkout.commit_checkout_payment(state, franchise, transaction, customer, events)
		assert_eq(state, scenario.after, state.countryCode)
		assert_eq(events, scenario.events, "no duplicate payment")

func test_till_and_training_intervals_match_typescript() -> void:
	for scenario in _oracle().timing:
		assert_near(Checkout.checkout_scan_interval(scenario.franchise, scenario.transaction, scenario.cashier), scenario.scan, 1e-10)
		assert_near(Checkout.checkout_bag_interval(scenario.cashier), scenario.bag, 1e-10)

func test_fallback_routes_match_typescript_between_store_and_farm() -> void:
	for scenario in _oracle().paths:
		assert_eq(Paths.safe_fallback_path(scenario.start, scenario.target), scenario.path)

func test_actor_acceleration_braking_and_waypoints_match_typescript() -> void:
	for scenario in _oracle().walking:
		var actor: Dictionary = scenario.initial.duplicate(true)
		for step in scenario.trace:
			assert_eq(Paths.walk_path_actor(actor, 100), step.arrived)
			_assert_actor(actor, step.actor)

func test_customers_and_employees_wait_for_the_real_door_to_open() -> void:
	for scenario in _oracle().doors:
		var actor: Dictionary = scenario.initial.duplicate(true)
		for step in scenario.trace:
			var arrived := Paths.walk_customer_through_automatic_door(actor, scenario.franchise, 100, scenario.direction) if scenario.who == "customer" else Paths.walk_employee_through_automatic_door(actor, scenario.franchise, 100)
			assert_eq(arrived, step.arrived)
			_assert_actor(actor, step.actor)

func test_customer_avoidance_matches_original_and_preserves_waiting_actors() -> void:
	for scenario in _oracle().avoidance:
		var customers: Array = scenario.before.duplicate(true)
		Paths.apply_customer_avoidance(customers)
		for index in customers.size():
			assert_eq(customers[index].state, scenario.after[index].state)
			assert_near(customers[index].x, scenario.after[index].x, 1e-12)
			assert_near(customers[index].z, scenario.after[index].z, 1e-12)

func _assert_actor(actual: Dictionary, expected: Dictionary) -> void:
	for key in actual:
		if key in ["x", "z", "currentSpeed"]: assert_near(actual[key], expected[key], 1e-12, key)
		else: assert_eq(actual[key], expected[key], key)
