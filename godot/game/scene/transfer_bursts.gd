class_name TransferBurstPresentation
extends Node3D
## MarketScene Harvest/Stock/Return/PayMagnetBurst. Simulation stays authoritative.
signal landed
var entries: Array = []
var flights := {}
var sequence := 0
var library: AuthoredScene
var templates := {}
var basket_target := Vector3.ZERO

func _ready() -> void:
	library = AuthoredScene.new()
	library.visible = false
	add_child(library)
	library.load_part("carry-products")
	for node in library.nodes.values():
		var source_name: String = node.get_meta("source_name", "")
		if source_name.begins_with("carry-product:"): templates[source_name.trim_prefix("carry-product:")] = node

func add_transfer(entry: Dictionary, areas: Array) -> void:
	sequence += 1
	entry = entry.duplicate(true)
	entry.sequence = sequence
	entry.remainingQuantity = entry.quantity
	entries.append(entry)
	var count := clampi(entry.quantity, 1, 8 if entry.kind == "pay" else 20)
	var particles := []
	for index in count:
		var particle := Node3D.new()
		particle.rotation_order = EULER_ORDER_XYZ
		add_child(particle)
		if entry.kind == "pay":
			for band in [false, true]:
				var mesh := MeshInstance3D.new()
				var box := BoxMesh.new()
				box.size = Vector3(0.07, 0.056, 0.106) if band else Vector3(0.2, 0.05, 0.1)
				mesh.mesh = box
				var material := StandardMaterial3D.new()
				material.albedo_color = Color("efe3b8" if band else "79b063")
				material.roughness = 0.9 if band else 0.85
				mesh.material_override = material
				mesh.scale = Vector3.ONE * 1.6
				mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				particle.add_child(mesh)
		else:
			var product: Node3D = templates[entry.productId].duplicate()
			particle.add_child(product)
			product.scale = Vector3.ONE * (1.22 if entry.kind == "harvest" else 1.16)
			_sparkle(particle, entry.kind == "harvest")
		particle.visible = false
		particles.append({"node": particle, "source": null, "target": _target(entry, index, count, areas)})
	flights[sequence] = {"elapsed": 0.0, "entry": entry, "particles": particles}
	while entries.size() > 16:
		var removed: Dictionary = entries.pop_front()
		_dispose_flight(removed.sequence)

func _target(entry: Dictionary, index: int, count: int, areas: Array) -> Vector3:
	if entry.kind == "harvest":
		var plot: Dictionary = FarmLayout.farm_plot_by_id(entry.cropId)
		return Vector3(plot.position[0] * 2 + (index % 3 - 1) * 0.28 * 1.6, 0.72 * 1.6 + 0.06 + floorf(index / 3.0) * 0.025, plot.position[2] * 2 + (floorf(index / 3.0) - (ceilf(count / 3.0) - 1) / 2) * 0.22 * 1.6)
	if entry.kind == "stock":
		var department: String = RetailLayout.PRODUCT_RETAIL_DEPARTMENT[entry.productId]
		var slot := RetailLayout.retail_stock_fixture_slot(department, entry.shelfStart + index, entry.shelfStart + count, areas)
		var display: Array = RetailLayout.retail_fixture_display_positions(department, areas)[slot.fixtureIndex]
		var landing := RetailLayout.retail_stock_landing_local_position(entry.productId, slot.localOrdinal, slot.localEnd)
		var yaw := deg_to_rad(RetailLayout.RETAIL_DEPARTMENTS[department].get("yaw", 0))
		return Vector3(display[0] * 2, 0, display[2] * 2) + Basis(Vector3.UP, yaw) * Vector3(landing[0], landing[1], landing[2]) * 1.6
	if entry.kind == "return":
		var point: Array = WarehouseLayout.WAREHOUSE_RETURN_STATION.position
		return Vector3(point[0] * 2 + (index % 4 - 1.5) * 0.09 * 1.6, 0.3 * 1.6, point[2] * 2)
	var point: Array = PurchaseLayout.PURCHASE_POSITIONS[entry.purchaseId]
	return Vector3(point[0] * 2 + (index % 3 - 1) * 0.12 * 1.6, point[1] + 0.06, point[2] * 2 + (index % 2 - 0.5) * 0.1 * 1.6)

func advance(delta: float) -> void:
	var changed := false
	for id in flights.keys():
		var flight: Dictionary = flights[id]
		var kind: String = flight.entry.kind
		flight.elapsed += clampf(delta, 0, 0.25) if is_finite(delta) else 0.0
		var remaining := 0
		for index in flight.particles.size():
			var particle: Dictionary = flight.particles[index]
			var interval := 0.045 if kind == "harvest" else (0.04 if kind == "pay" else 0.065)
			var duration := 0.52 if kind == "harvest" else (0.32 if kind == "pay" else 0.5)
			var started: bool = flight.elapsed >= index * interval
			if started and particle.source == null: particle.source = basket_target
			var t := clampf((flight.elapsed - index * interval) / duration, 0, 1)
			if t < 1: remaining += 1
			var node: Node3D = particle.node
			node.visible = t < 1 and started
			if not node.visible: continue
			var eased := 1 - pow(1 - t, 3) if kind == "harvest" else t * t * (3 - 2 * t)
			var source: Vector3 = particle.target if kind == "harvest" else particle.source
			var target: Vector3 = basket_target if kind == "harvest" else particle.target
			node.position = source.lerp(target, eased)
			node.position.y += sin(PI * t) * (1.35 if kind == "harvest" else (0.7 if kind == "pay" else 0.82))
			if kind == "harvest":
				node.rotation.y += delta * (5.5 + index)
				node.rotation.z = sin(t * PI * 3 + index) * 0.28
				node.scale = Vector3.ONE * (0.86 + sin(PI * t) * 0.24) * (1 - t * 0.18)
			elif kind == "pay":
				node.rotation.x += delta * (6 + index)
				node.rotation.z += delta * 4
			else:
				node.rotation.x += delta * (3.5 + index * 0.3)
				node.rotation.y += delta * (5.2 + index * 0.45)
				node.scale = Vector3.ONE * (0.94 + sin(PI * t) * 0.18)
		if remaining != flight.entry.remainingQuantity:
			flight.entry.remainingQuantity = remaining
			entries = VisualTransferLedger.update_visual_transfer_remaining(entries, id, remaining)
			changed = true
		if remaining == 0: _dispose_flight(id)
	if changed: landed.emit()

func _dispose_flight(id: int) -> void:
	for particle in flights[id].particles: particle.node.free()
	flights.erase(id)

func _sparkle(parent: Node3D, harvest: bool) -> void:
	var mesh := MeshInstance3D.new()
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var radius := 0.035 if harvest else 0.03
	for top in [1, -1]:
		for side in 4:
			var a := Vector3(cos(side * PI / 2), 0, sin(side * PI / 2)) * radius
			var b := Vector3(cos((side + 1) * PI / 2), 0, sin((side + 1) * PI / 2)) * radius
			for vertex in [Vector3(0, top * radius, 0), a if top > 0 else b, b if top > 0 else a]: surface.add_vertex(vertex)
	mesh.mesh = surface.commit()
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	material.albedo_color = Color("fff1a6", 0.9 if harvest else 0.82)
	mesh.material_override = material
	mesh.position = Vector3(0.1 if harvest else 0, 0.1, 0)
	mesh.rotation.z = PI / 4 if harvest else 0
	mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mesh)

