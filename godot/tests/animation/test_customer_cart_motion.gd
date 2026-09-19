extends TestCase

func test_passes_a_picked_product_through_the_customers_hand_before_the_cart() -> void:
	var source := [0.0, 1.0, 2.0]
	var hand := [0.5, 1.2, 1.0]
	var cart := [0.0, 0.6, 0.5]
	assert_eq(CustomerCartMotion.product_transfer_point(source, hand, cart, 0.0), source)
	assert_eq(CustomerCartMotion.product_transfer_point(source, hand, cart, 0.42), hand)
	assert_eq(CustomerCartMotion.product_transfer_point(source, hand, cart, 1.0), cart)
	assert_gt(CustomerCartMotion.product_transfer_point(source, hand, cart, 0.2)[1], 1.0)

func test_eases_taking_and_returning_a_cart_without_overshooting() -> void:
	assert_eq(CustomerCartMotion.eased_motion_progress(-10, 450), 0.0)
	assert_near(CustomerCartMotion.eased_motion_progress(225, 450), 0.5, 0.005)
	assert_eq(CustomerCartMotion.eased_motion_progress(900, 450), 1.0)

func test_rolls_wheels_by_travelled_circumference_and_clamps_caster_steering() -> void:
	assert_near(CustomerCartMotion.wheel_roll_delta(0.15, 0.075), 2.0, 0.005)
	assert_near(CustomerCartMotion.shortest_heading_delta(PI - 0.1, -PI + 0.1), 0.2, 0.005)
	assert_eq(CustomerCartMotion.cart_steering_angle(0.4, 1.0 / 60.0), 0.48)
	assert_eq(CustomerCartMotion.cart_steering_angle(-0.4, 1.0 / 60.0), -0.48)

func test_removes_loaded_checkout_units_from_the_cart_without_mutating_the_saved_basket() -> void:
	var basket := { "tomatoes": 3, "apples": 2 }
	var remaining := CustomerCartMotion.checkout_cart_inventory(basket, {
		"state": "CUSTOMER_LOADING",
		"pendingItems": [
			{ "productId": "tomatoes", "quantity": 3, "loaded": 1, "scanned": 0, "bagged": 0 },
			{ "productId": "apples", "quantity": 2, "loaded": 2, "scanned": 1, "bagged": 0 },
		],
	})
	assert_eq(remaining, { "tomatoes": 2 })
	assert_eq(basket, { "tomatoes": 3, "apples": 2 })

func test_keeps_the_complete_cart_when_a_checkout_is_abandoned() -> void:
	assert_eq(CustomerCartMotion.checkout_cart_inventory({ "bread": 2 }, {
		"state": "ABANDONED",
		"pendingItems": [{ "productId": "bread", "quantity": 2, "loaded": 2, "scanned": 1, "bagged": 0 }],
	}), { "bread": 2 })

func test_drives_one_checkout_gesture_cycle_for_every_authoritatively_loading_unit() -> void:
	var transaction := {
		"id": "checkout-1",
		"state": "CUSTOMER_LOADING",
		"lastLoadedAt": 1000,
		"pendingItems": [
			{ "productId": "tomatoes", "quantity": 2, "loaded": 1, "scanned": 0, "bagged": 0 },
			{ "productId": "bread", "quantity": 1, "loaded": 0, "scanned": 0, "bagged": 0 },
		],
	}
	assert_eq(CustomerCartMotion.checkout_loading_presentation("WAIT_CHECKOUT", transaction, 1450), {
		"transactionId": "checkout-1", "unitIndex": 1, "remainingUnits": 2, "cycleProgress": 0.5,
	})
	assert_null(CustomerCartMotion.checkout_loading_presentation("QUEUE_WAIT", transaction, 1450))
	assert_null(CustomerCartMotion.checkout_loading_presentation("WAIT_CHECKOUT", JS.spread(transaction, { "state": "SCANNING" }), 1450))

func test_assigns_a_different_rigid_handle_end_to_each_hand_with_minimum_total_travel() -> void:
	var result := CustomerCartMotion.assign_cart_grip_targets(Vector3(-0.4, 1, 0), Vector3(0.4, 1, 0), Vector3(0.5, 1, 0), Vector3(-0.5, 1, 0))
	assert_true(result.crossed)
	assert_eq(result.leftTarget, Vector3(-0.5, 1, 0))
	assert_eq(result.rightTarget, Vector3(0.5, 1, 0))
	assert_false(result.leftTarget == result.rightTarget)

func test_closes_the_wrist_to_handle_gap_with_a_bounded_two_joint_correction() -> void:
	var root := Node3D.new()
	var upper_arm := Node3D.new()
	var forearm := Node3D.new()
	var hand := Node3D.new()
	forearm.position.x = 1
	hand.position.x = 1
	root.add_child(upper_arm)
	upper_arm.add_child(forearm)
	forearm.add_child(hand)
	var target := Vector3(1.6, 0.8, 0)
	var before := CarrySocket.world_transform_of(hand).origin.distance_to(target)
	var after := CustomerCartMotion.CustomerCartGripSolver.new().solve_nodes(upper_arm, forearm, hand, target)
	assert_lt(after, before * 0.08)
	assert_lte(upper_arm.quaternion.angle_to(Quaternion.IDENTITY), 0.51 + 1e-6)
	# 1.1 rad remains well inside anatomical elbow flexion while allowing the
	# wrist to meet a rigid bar instead of stretching the cart itself.
	assert_lte(forearm.quaternion.angle_to(Quaternion.IDENTITY), 1.1 + 1e-6)
	root.free()

func test_keeps_the_grip_correction_finite_when_a_target_is_outside_arm_reach() -> void:
	var chain := {
		"upperArm": Transform3D.IDENTITY,
		"forearm": Transform3D(Basis.IDENTITY, Vector3(0.4, 0, 0)),
		"hand": Transform3D(Basis.IDENTITY, Vector3(0.4, 0, 0)),
	}
	var after := CustomerCartMotion.CustomerCartGripSolver.new().solve(chain, Vector3(50, 20, -10))
	assert_true(is_finite(after))
	assert_lte(chain.upperArm.basis.get_rotation_quaternion().angle_to(Quaternion.IDENTITY), 0.51 + 1e-6)
	assert_lte(chain.forearm.basis.get_rotation_quaternion().angle_to(Quaternion.IDENTITY), 1.1 + 1e-6)
