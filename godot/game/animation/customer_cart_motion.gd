class_name CustomerCartMotion
extends RefCounted
## Port of src/game/animation/CustomerCartMotion.ts.
## MotionPoint3 → Array [x, y, z]. Inventory / transaction → Dictionary.

const CUSTOMER_PICKUP_DURATION_MS := 520
const CUSTOMER_CART_WHEEL_RADIUS := 0.075
const CUSTOMER_CHECKOUT_ITEM_CYCLE_MS := 900

## Allocation-free analytic two-segment IK for the small correction between
## the authored carry pose and a rigid cart handle. Animation still owns the
## pose every frame; this solver only closes the final wrist-to-handle gap.
##
## The chain is a Dictionary of LOCAL transforms (each relative to its parent):
##   { "parent": Transform3D (world transform of the upper arm's parent, identity by default),
##     "upperArm": Transform3D, "forearm": Transform3D, "hand": Transform3D }
## `solve` rotates `upperArm` and `forearm` in place and returns the remaining
## hand-to-target distance. `solve_nodes` adapts a Node3D chain (bone
## attachments or plain Node3Ds) by reading and writing their local transforms.
class CustomerCartGripSolver extends RefCounted:
	func solve(chain: Dictionary, target: Vector3) -> float:
		var parent_world: Transform3D = chain.get("parent", Transform3D.IDENTITY)
		var upper_world: Transform3D = parent_world * chain.upperArm
		var elbow_world: Transform3D = upper_world * chain.forearm
		var hand_world: Transform3D = elbow_world * chain.hand
		var joint_position := upper_world.origin
		var elbow_position := elbow_world.origin
		var hand_position := hand_world.origin
		var upper_length := joint_position.distance_to(elbow_position)
		var forearm_length := elbow_position.distance_to(hand_position)
		var target_direction := target - joint_position
		var target_distance := target_direction.length()
		if upper_length > 1e-4 and forearm_length > 1e-4 and target_distance > 1e-4:
			target_direction = target_direction * (1.0 / target_distance)
			var reach := clampf(target_distance, absf(upper_length - forearm_length) + 1e-4, upper_length + forearm_length - 1e-4)
			var elbow_along_target := (upper_length * upper_length - forearm_length * forearm_length + reach * reach) / (2.0 * reach)
			var elbow_off_axis := sqrt(maxf(0.0, upper_length * upper_length - elbow_along_target * elbow_along_target))
			var bend_direction := elbow_position - joint_position
			bend_direction += target_direction * (-bend_direction.dot(target_direction))
			if bend_direction.length_squared() < 1e-8:
				bend_direction = (upper_world.basis * Vector3(0, 0, 1)).normalized()
				bend_direction += target_direction * (-bend_direction.dot(target_direction))
			if bend_direction.length_squared() >= 1e-8:
				bend_direction = bend_direction.normalized()
				var desired_elbow := joint_position + target_direction * elbow_along_target + bend_direction * elbow_off_axis
				_rotate_joint(chain, "upperArm", parent_world, "forearm", desired_elbow, 0.51)
		# The forearm supplies the final reach while the bounded shoulder change
		# preserves the authored silhouette and avoids a robotic straight arm.
		_rotate_joint(chain, "forearm", parent_world * chain.upperArm, "hand", target, 1.1)
		hand_position = (parent_world * chain.upperArm * chain.forearm * chain.hand).origin
		return hand_position.distance_to(target)

	## Node3D adapter: upper_arm → forearm → hand must be a parent/child chain.
	func solve_nodes(upper_arm: Node3D, forearm: Node3D, hand: Node3D, target: Vector3) -> float:
		var parent := upper_arm.get_parent()
		var chain := {
			"parent": CarrySocket.world_transform_of(parent) if parent is Node3D else Transform3D.IDENTITY,
			"upperArm": upper_arm.transform,
			"forearm": forearm.transform,
			"hand": hand.transform,
		}
		var distance := solve(chain, target)
		upper_arm.transform = chain.upperArm
		forearm.transform = chain.forearm
		return distance

	func _rotate_joint(chain: Dictionary, joint_key: String, joint_parent_world: Transform3D, end_key: String, target: Vector3, max_radians: float) -> void:
		var joint_local: Transform3D = chain[joint_key]
		var joint_world := joint_parent_world * joint_local
		var end_world: Transform3D = joint_world * chain[end_key]
		var joint_position := joint_world.origin
		var current_direction := end_world.origin - joint_position
		var target_direction := target - joint_position
		var current_length_sq := current_direction.length_squared()
		var target_length_sq := target_direction.length_squared()
		if current_length_sq < 1e-8 or target_length_sq < 1e-8: return
		current_direction = current_direction * (1.0 / sqrt(current_length_sq))
		target_direction = target_direction * (1.0 / sqrt(target_length_sq))
		var cosine := clampf(current_direction.dot(target_direction), -1.0, 1.0)
		var angle := minf(acos(cosine), max_radians)
		if angle < 1e-5: return
		var rotation_axis := current_direction.cross(target_direction)
		if rotation_axis.length_squared() < 1e-8: return
		rotation_axis = rotation_axis.normalized()
		var world_delta := Quaternion(rotation_axis, angle)
		var joint_world_quaternion := joint_world.basis.get_rotation_quaternion()
		var desired_world_quaternion := world_delta * joint_world_quaternion
		var parent_inverse := joint_parent_world.basis.get_rotation_quaternion().inverse()
		var local_scale := joint_local.basis.get_scale()
		joint_local.basis = Basis(parent_inverse * desired_world_quaternion) * Basis.from_scale(local_scale)
		chain[joint_key] = joint_local

## Assign distinct handle ends with the minimum total hand travel.
## Returns { "crossed": bool, "leftTarget": Vector3, "rightTarget": Vector3 }.
static func assign_cart_grip_targets(left_hand: Vector3, right_hand: Vector3, end_a: Vector3, end_b: Vector3) -> Dictionary:
	var direct := left_hand.distance_squared_to(end_a) + right_hand.distance_squared_to(end_b)
	var crossed := left_hand.distance_squared_to(end_b) + right_hand.distance_squared_to(end_a)
	if direct <= crossed:
		return { "crossed": false, "leftTarget": end_a, "rightTarget": end_b }
	return { "crossed": true, "leftTarget": end_b, "rightTarget": end_a }

static func motion_progress(elapsed_ms: float, duration_ms: float) -> float:
	if not is_finite(elapsed_ms) or duration_ms <= 0.0: return 1.0 if elapsed_ms > 0.0 else 0.0
	return minf(1.0, maxf(0.0, elapsed_ms / duration_ms))

static func eased_motion_progress(elapsed_ms: float, duration_ms: float) -> float:
	var progress := motion_progress(elapsed_ms, duration_ms)
	return progress * progress * (3.0 - 2.0 * progress)

## A two-stage shelf -> hand -> cart route. Keeping the hand as a real waypoint
## makes the purchase readable instead of teleporting stock between counters.
static func product_transfer_point(source: Array, hand: Array, cart: Array, progress: float) -> Array:
	var value := minf(1.0, maxf(0.0, progress))
	var first_leg := value <= 0.42
	var leg_progress := value / 0.42 if first_leg else (value - 0.42) / 0.58
	var eased := leg_progress * leg_progress * (3.0 - 2.0 * leg_progress)
	var start := source if first_leg else hand
	var end := hand if first_leg else cart
	var lift := sin(PI * eased) * (0.13 if first_leg else 0.2)
	return [
		start[0] + (end[0] - start[0]) * eased,
		start[1] + (end[1] - start[1]) * eased + lift,
		start[2] + (end[2] - start[2]) * eased,
	]

static func wheel_roll_delta(distance: float, radius: float = CUSTOMER_CART_WHEEL_RADIUS) -> float:
	if not is_finite(distance) or not is_finite(radius) or radius <= 0.0: return 0.0
	return distance / radius

static func shortest_heading_delta(previous: float, current: float) -> float:
	var full_turn := PI * 2.0
	return fmod(fmod(current - previous + PI, full_turn) + full_turn, full_turn) - PI

static func cart_steering_angle(heading_delta: float, delta_seconds: float) -> float:
	if not is_finite(heading_delta) or not is_finite(delta_seconds) or delta_seconds <= 0.0: return 0.0
	return minf(0.48, maxf(-0.48, heading_delta / delta_seconds * 0.16))

## The save keeps the customer's complete purchase until bag handoff. For the
## cart presentation, units cease to belong to the cart the instant the
## authoritative checkout transaction marks them as loaded.
static func checkout_cart_inventory(basket: Dictionary, transaction: Variant = null) -> Dictionary:
	var remaining := {}
	for product_id in basket:
		var quantity = basket[product_id]
		if quantity > 0: remaining[product_id] = quantity
	if transaction == null or transaction.state == "ABANDONED": return remaining
	for line in transaction.pendingItems:
		var quantity = maxi(0, int(JS.get_or(remaining, line.productId, 0)) - mini(int(line.quantity), maxi(0, int(line.loaded))))
		if quantity > 0: remaining[line.productId] = quantity
		else: remaining.erase(line.productId)
	return remaining

## Mirrors one authoritative checkout-loading interval as presentation data.
## The transaction remains the source of truth: this helper never advances an
## item, it only gives the character a readable gesture for the current unit.
static func checkout_loading_presentation(customer_state: String, transaction: Variant, simulation_time_ms: int, cycle_ms: int = CUSTOMER_CHECKOUT_ITEM_CYCLE_MS) -> Variant:
	if customer_state != "WAIT_CHECKOUT" or transaction == null or transaction.state != "CUSTOMER_LOADING": return null
	var total := 0
	var loaded := 0
	for line in transaction.pendingItems:
		total += maxi(0, int(line.quantity))
		loaded += mini(maxi(0, int(line.quantity)), maxi(0, int(line.loaded)))
	if loaded >= total: return null
	return {
		"transactionId": transaction.id,
		"unitIndex": loaded,
		"remainingUnits": total - loaded,
		"cycleProgress": motion_progress(simulation_time_ms - int(transaction.lastLoadedAt), cycle_ms),
	}
