class_name CustomerCartPresentation
extends Node3D
## Customer.tsx rigid cart, inventory, parking, caster steering and wheel roll.
const Authored = preload("res://game/scene/authored_scene.gd")
const CASTER_POSITIONS = [Vector3(-0.3, 0.09, 0.27), Vector3(0.3, 0.09, 0.27), Vector3(-0.3, 0.09, -0.22), Vector3(0.3, 0.09, -0.22)]
var chassis: Node3D
var handle: Node3D
var basket: Node3D
var bag: Node3D
var casters: Node3D
var wheels: Node3D
var products: Authored
var templates := {}
var contents: Node3D
var signature := ""
var was_visible := false
var previous_state := ""
var state_started := 0.0
var clock_ms := 0.0
var heading := 0.0
var steering := 0.0
var wheel_roll := 0.0
var previous_position := Vector3.ZERO

func _ready() -> void:
	var source := Authored.new()
	add_child(source)
	source.load_part("customer-cart")
	for node in source.nodes.values():
		match node.get_meta("source_name", ""):
			"customer-cart": chassis = node
			"cart-handle": handle = node
			"cart-basket": basket = node
			"cart-bag": bag = node
			"CustomerCartCasters": casters = node
			"CustomerCartWheels": wheels = node
	contents = Node3D.new()
	basket.add_child(contents)
	products = Authored.new()
	products.visible = false
	add_child(products)
	products.load_part("carry-products")
	for node in products.nodes.values():
		var authored_name: String = node.get_meta("source_name", "")
		if authored_name.begins_with("carry-product:"): templates[authored_name.trim_prefix("carry-product:")] = node
	visible = false

func update_inventory(customer: Dictionary, transaction: Variant, compact: bool) -> void:
	bag.visible = customer.hasBag
	var inventory := CustomerCartMotion.checkout_cart_inventory(customer.basket, transaction)
	var next_signature := JSON.stringify([inventory, compact])
	if signature == next_signature: return
	signature = next_signature
	for child in contents.get_children(): child.free()
	var index := 0
	for product in inventory:
		for unit in mini(inventory[product], 2 if compact else 3):
			if index >= (5 if compact else 8): return
			var model: Node3D = templates[product].duplicate()
			contents.add_child(model)
			model.position = Vector3((index % 3 - 1) * 0.18, floorf(index / 3.0) * 0.14, (-1 if index % 2 else 1) * 0.12)
			model.rotation_order = EULER_ORDER_XYZ
			model.rotation = Vector3(0, index * 1.41, -0.08 if index % 2 else 0.08)
			model.scale = Vector3.ONE * 1.05
			index += 1

func animate(actor: MarketActor, customer: Dictionary, loading: Variant, delta: float) -> void:
	clock_ms += minf(delta, 0.05) * 1000
	var old_state := previous_state
	if previous_state != customer.state:
		state_started = clock_ms
		previous_state = customer.state
	var elapsed := clock_ms - state_started
	visible = customer.hasCart or customer.state == "GET_CART"
	if not visible:
		was_visible = false
		return
	var left_index := actor.skeleton.find_bone("Hand_L")
	var right_index := actor.skeleton.find_bone("Hand_R")
	if left_index < 0 or right_index < 0: return
	var left := to_local(actor.skeleton.global_transform * actor.skeleton.get_bone_global_pose(left_index).origin)
	var right := to_local(actor.skeleton.global_transform * actor.skeleton.get_bone_global_pose(right_index).origin)
	var midpoint := (left + right) * 0.5
	var grip := midpoint
	var single_left: bool = loading != null or customer.state in ["PICK_PRODUCT", "UNLOAD", "PAY", "LEAVE_RETURNS", "RETURN_CART"]
	var settling: bool = customer.state == "NAVIGATE_TO_PRODUCT" and customer.currentLine == 0 and customer.shoppingList.all(func(line): return line.picked == 0) and elapsed < 240
	var single_right: bool = customer.state in ["GET_CART", "BUILD_SHOPPING_LIST", "TAKE_BAG"] or settling
	if single_left: grip = left + Vector3(0.44 * 0.92 * 0.5, 0, 0)
	elif single_right: grip = right - Vector3(0.44 * 0.92 * 0.5, 0, 0)
	var desired := Vector3(grip.x, 0, grip.z + 0.43 * 0.92)
	var parked: Variant = CheckoutLayout.checkout_parked_cart(customer)
	if parked != null: desired = to_local(actor.get_parent().to_global(Vector3(parked[0] * 2, 0, parked[1] * 2)))
	if customer.state in ["GET_CART", "RETURN_CART"]:
		var bay := StoreServiceLayout.CART_BAY_POINT
		var bay_local := to_local(actor.get_parent().to_global(Vector3(bay[0] * 2, 0, bay[1] * 2)))
		var progress := CustomerCartMotion.eased_motion_progress(elapsed, 450 if customer.state == "GET_CART" else 420)
		desired = bay_local.lerp(desired, progress) if customer.state == "GET_CART" else desired.lerp(bay_local, progress)
	if not was_visible or (old_state == "GET_CART" and customer.state != "GET_CART"): chassis.position = desired
	else:
		chassis.position = chassis.position.lerp(desired, 1 - exp(-30 * minf(delta, 0.05)))
		var lag := chassis.position.distance_to(desired)
		if lag > 0.075: chassis.position = chassis.position.lerp(desired, 1 - 0.075 / lag)
	chassis.rotation.y = lerpf(chassis.rotation.y, -actor.rotation.y if parked != null else 0, 1 - exp(-14 * minf(delta, 0.05)))
	if parked == null: chassis.position += midpoint - to_local(handle.global_position)
	var heading_delta := CustomerCartMotion.shortest_heading_delta(heading, actor.rotation.y)
	steering = lerpf(steering, CustomerCartMotion.cart_steering_angle(heading_delta, minf(delta, 0.05)), 1 - exp(-10 * minf(delta, 0.05)))
	var travel := chassis.global_position - previous_position
	if was_visible:
		var signed_distance := travel.length() / 3.0 * (1 if travel.dot(chassis.global_basis.z) >= 0 else -1)
		wheel_roll -= CustomerCartMotion.wheel_roll_delta(signed_distance / 0.92)
	previous_position = chassis.global_position
	for index in 4:
		var yaw := steering if index < 2 else steering * 0.32
		casters.get_child(index).transform = Transform3D(Basis(Vector3.UP, yaw), CASTER_POSITIONS[index])
		wheels.get_child(index).transform = Transform3D(Basis(Vector3.UP, yaw) * Basis(Vector3.RIGHT, wheel_roll), CASTER_POSITIONS[index])
	heading = actor.rotation.y
	was_visible = true

