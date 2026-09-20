class_name HarvestBasketPresentation
extends Node3D
const Authored = preload("res://game/scene/authored_scene.gd")
var source: Authored
var products: Authored
var container: Node3D
var handle: Node3D
var templates: Dictionary = {}
var signature := ""

func _ready() -> void:
	source = Authored.new()
	add_child(source)
	source.load_part("basket")
	for node in source.nodes.values():
		var authored_name: String = node.get_meta("source_name", "")
		if authored_name.begins_with("Basket") or authored_name.begins_with("HarvestBasket"): node.name = authored_name
		if authored_name == "HarvestBasketProducts": container = node
		if authored_name == "HarvestBasketAdaptiveHandle": handle = node
	for child in container.get_children(): child.free()
	products = Authored.new()
	products.visible = false
	add_child(products)
	products.load_part("carry-products")
	for node in products.nodes.values():
		var authored_name: String = node.get_meta("source_name", "")
		if authored_name.begins_with("carry-product:"): templates[authored_name.trim_prefix("carry-product:")] = node

func update(carry: Dictionary) -> void:
	visible = CarrySystem.carry_total(carry) > 0
	var next_signature := JSON.stringify(carry.items)
	if next_signature == signature: return
	signature = next_signature
	for child in container.get_children(): child.free()
	var index := 0
	for product in CarrySystem.carried_product_ids(carry):
		for unit in CarrySystem.carry_quantity(carry, product):
			if index >= CarrySystem.MAX_WAREHOUSE_PICKUP_BATCH: return
			var model: Node3D = templates[product].duplicate()
			container.add_child(model)
			var column := index % 4
			var depth := int(index / 4) % 2
			var layer := int(index / 8)
			model.position = Vector3((column - 1.5) * 0.13, layer * 0.105, (depth - 0.5) * 0.13)
			model.rotation_order = EULER_ORDER_XYZ
			model.rotation = Vector3(0, fmod(index * 1.71, PI), -0.08 if index % 2 else 0.08)
			model.scale = Vector3.ONE * 0.78
			index += 1

func place(left_palm: Vector3, right_palm: Vector3) -> void:
	var placement := CarrySocket.place_carry_socket(left_palm, right_palm)
	CarrySocket.apply_placement(self, placement)
	CarrySocket.apply_harvest_basket_handle(handle, placement.handleScale)

