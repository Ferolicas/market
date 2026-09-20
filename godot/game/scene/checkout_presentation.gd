class_name CheckoutPresentation
extends Node3D
## MarketKit CheckoutKit/CheckoutProductUnit/CheckoutBag and service fixtures.
var lanes := []
var carts := []
var lamps := []
var ceiling_lights := []
var dynamic_ceiling_lights := true
var dairy_doors := []
var returns_root: Node3D
var returns_contents: Node3D
var returns_signature := ""
var cold_open := false
var templates := {}
var bag_template: Node3D

func _ready() -> void:
	var source := AuthoredScene.new()
	source.visible = false
	add_child(source)
	source.load_part("checkout-bag")
	for node in source.nodes.values():
		if node.get_meta("source_name", "") == "checkout-bag": bag_template = node

func bind(scene: AuthoredScene, product_templates: Dictionary) -> void:
	templates = product_templates
	for node in scene.nodes.values():
		var name_value: String = node.get_meta("source_name", "")
		if name_value == "bay-cart": carts.append(node)
		if name_value.begins_with("DairyDoor") and name_value.trim_prefix("DairyDoor") in ["1", "2", "3"]: dairy_doors.append(node)
		if name_value == "dynamic:ceiling-lamp":
			lamps.append(node)
			var light := OmniLight3D.new()
			light.position = Vector3(0, -0.15, 0)
			light.light_color = Color("fff2c9")
			light.light_energy = 0.18 / PI
			light.omni_range = 4
			light.visible = false
			node.add_child(light)
			ceiling_lights.append(light)
		if name_value == "fixture:returns":
			returns_root = node
			returns_contents = Node3D.new()
			node.add_child(returns_contents)
		if name_value != "dynamic:checkout": continue
		var view := {"root": node, "units": {}, "bags": [], "scanner": null, "screen": null, "terminal": null, "label": null, "scan_light": null}
		for child in node.get_children():
			if child.get_meta("source_name", "") == "checkout-bag":
				node.remove_child(child)
				child.queue_free()
			if child is MeshInstance3D:
				if child.position.distance_to(Vector3(0.64, 1.165, 0)) < 0.0001: view.scanner = SourcePbr.source_material(child, 0)
				if child.position.distance_to(Vector3(1.28, 1.62, -0.07)) < 0.0001: view.screen = SourcePbr.source_material(child, 0)
				if child.position.distance_to(Vector3(1.78, 1.26, 0.26)) < 0.0001: view.terminal = SourcePbr.source_material(child, 0)
			if child is Label3D and child.position.distance_to(Vector3(1.28, 1.63, -0.01)) < 0.0001: view.label = child
		for index in 2:
			var bag: Node3D = bag_template.duplicate()
			node.add_child(bag)
			bag.visible = false
			view.bags.append(bag)
		var light := OmniLight3D.new()
		light.position = Vector3(0.64, 1.35, 0)
		light.light_color = Color("64ffc2")
		light.light_energy = 1.4 / PI
		light.omni_range = 1.4
		light.visible = false
		node.add_child(light)
		view.scan_light = light
		lanes.append(view)

func update(franchise: Dictionary) -> void:
	for lane in lanes.size():
		var view: Dictionary = lanes[lane]
		var transaction: Variant = CheckoutLayout.active_checkout_for_lane(franchise.checkoutTransactions, lane)
		var handoff: Variant = CheckoutLayout.checkout_handoff_for_lane(franchise.checkoutTransactions, lane, franchise.customers)
		var separate: bool = handoff != null and CheckoutLayout.checkout_bag_location(handoff, franchise.customers) == "counter"
		var scanning: bool = transaction != null and transaction.state in ["SCANNING", "BAGGING"]
		var total := _count(transaction, "quantity")
		var bagged := _count(transaction, "bagged")
		view.scanner.emission_enabled = true
		view.scanner.emission = Color("60ffbd" if scanning else "2d6553")
		view.scanner.emission_energy_multiplier = 2.2 if scanning else 0.5
		view.scan_light.visible = scanning
		view.screen.emission = Color("4d9b80" if transaction != null else "27463d")
		view.screen.emission_enabled = true
		view.screen.emission_energy_multiplier = 0.8
		var paying: bool = transaction != null and transaction.state == "PAYMENT"
		view.terminal.albedo_color = Color("91f2be" if paying else "77948a")
		view.terminal.emission_enabled = true
		view.terminal.emission = Color("42a776")
		view.terminal.emission_energy_multiplier = 1.4 if paying else 0.18
		for material in [view.scanner, view.screen, view.terminal]: SourcePbr.touch(material)
		view.label.text = "%s/%s" % [bagged, total] if transaction != null else "LISTA"
		var bag_index := 0
		if transaction != null:
			_bag(view.bags[bag_index], float(bagged) / total if total else 0.0, Vector3(1.34, 1.02, 0.24) if separate else Vector3(1.67, 1.02, 0))
			bag_index += 1
		if separate:
			var handoff_total := _count(handoff, "quantity")
			_bag(view.bags[bag_index], float(_count(handoff, "bagged")) / handoff_total if handoff_total else 1.0, Vector3(1.94, 1.02, -0.24) if transaction != null else Vector3(1.67, 1.02, 0))
			bag_index += 1
		if transaction == null and handoff == null:
			_bag(view.bags[bag_index], 0, Vector3(1.67, 1.02, 0))
			bag_index += 1
		for index in range(bag_index, 2): view.bags[index].visible = false
		var present := {}
		var index := 0
		if transaction != null:
			for line in transaction.pendingItems:
				for unit in int(line.quantity):
					var key := "%s-%s" % [line.productId, index]
					if unit < line.loaded and unit >= line.bagged:
						present[key] = true
						if not view.units.has(key):
							var product: Node3D = templates[line.productId].duplicate()
							view.root.add_child(product)
							product.position = Vector3(-2.05, 1.45, 0.42)
							product.scale = Vector3.ONE * 1.18
							view.units[key] = {"node": product, "target": Vector3.ZERO}
						view.units[key].target = Vector3(1.48, 1.38, 0.18) if unit < line.scanned else Vector3(minf(0.15, -1.66 + index * 0.29), 1.25, 0)
					index += 1
		for key in view.units.keys():
			if not present.has(key):
				view.units[key].node.queue_free()
				view.units.erase(key)
	for index in carts.size(): carts[index].visible = index < clampi(franchise.returnedCartCount, 2, 4)
	cold_open = franchise.customers.any(func(customer): return customer.state in ["WAIT_FOR_ACCESS", "PICK_PRODUCT"] and customer.currentLine < customer.shoppingList.size() and customer.shoppingList[customer.currentLine].productId in ["milk", "cheese"])
	for light in ceiling_lights: light.visible = franchise.lightsOn and dynamic_ceiling_lights
	for lamp in lamps:
		for mesh in lamp.find_children("*", "MeshInstance3D", true, false):
			for surface in mesh.mesh.get_surface_count():
				var material: Material = SourcePbr.source_material(mesh, surface)
				if material is StandardMaterial3D:
					material.emission_enabled = franchise.lightsOn
					material.emission = Color("fff0b8" if franchise.lightsOn else "000000")
					material.emission_energy_multiplier = 1.1 if franchise.lightsOn else 0
	var signature := JSON.stringify(franchise.returnsBin)
	if returns_contents != null and returns_signature != signature:
		returns_signature = signature
		for child in returns_contents.get_children(): child.free()
		var index := 0
		for product in franchise.returnsBin:
			for unit in mini(6, franchise.returnsBin[product]):
				if index >= 6: break
				var model: Node3D = templates[product].duplicate()
				returns_contents.add_child(model)
				model.position = Vector3((index % 3 - 1) * 0.24, 0.62 + floorf(index / 3.0) * 0.2, 0.48)
				index += 1

func animate(delta: float) -> void:
	for view in lanes:
		for unit in view.units.values(): unit.node.position = unit.node.position.lerp(unit.target, 1 - exp(-8 * delta))
	for door in dairy_doors: door.rotation.y = lerpf(door.rotation.y, -1.05 if cold_open else 0.0, 1 - exp(-8 * minf(delta, 0.05)))

static func _count(transaction: Variant, key: String) -> int:
	var total := 0
	if transaction != null:
		for line in transaction.pendingItems: total += line[key]
	return total

static func _bag(bag: Node3D, fill: float, location: Vector3) -> void:
	bag.visible = true
	bag.position = location
	bag.scale = Vector3(1, 0.72 + fill * 0.28, 1)
	for child in bag.get_children():
		if child is MeshInstance3D and child.position.distance_to(Vector3(0, 0.26, 0)) < 0.0001: child.visible = fill > 0
