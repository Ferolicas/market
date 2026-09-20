class_name RetailInventoryPresentation
extends RefCounted
## Render the exact authoritative SKU counts and authored landing positions.
## Each original component mesh becomes one MultiMesh per display/SKU.
const Authored = preload("res://game/scene/authored_scene.gd")
var groups: Dictionary = {}
var templates: Dictionary = {}
var _counts: Dictionary = {}

func bind(scene: Authored) -> void:
	for entry in scene.manifest.manifest:
		if not entry.sourceName.begins_with("retail-stock:"): continue
		var product: String = entry.sourceName.trim_prefix("retail-stock:")
		if product not in groups: groups[product] = []
		var node: Node3D = scene.nodes[entry.name]
		groups[product].append({"node": node, "batches": [], "labels": _stock_labels(node, product)})

func _stock_labels(node: Node3D, product: String) -> Array:
	var parent: Node = node.get_parent()
	while parent != null and not str(parent.get_meta("source_name", "")).begins_with("retail-department:"):
		parent = parent.get_parent()
	if parent == null: return []
	var result: Array = []
	for candidate in parent.find_children("*", "Node3D", true, false):
		if candidate.get_meta("source_name", "") in ["retail-stock-screen:" + product, "retail-slot-sign:" + product]: result.append_array(candidate.find_children("*", "Label3D", true, false))
	return result

func _template(product: String) -> Array:
	if product in templates: return templates[product]
	var source := Authored.new()
	source.load_part("product-" + product)
	var result: Array = []
	for mesh in source.find_children("*", "MeshInstance3D", true, false):
		var transform: Transform3D = mesh.transform
		var parent: Node = mesh.get_parent()
		while parent != source:
			if parent is Node3D: transform = parent.transform * transform
			parent = parent.get_parent()
		var copied_mesh: Mesh = mesh.mesh.duplicate()
		for surface in copied_mesh.get_surface_count(): copied_mesh.surface_set_material(surface, SourcePbr.source_material(mesh, surface))
		result.append({"mesh": copied_mesh, "transform": transform, "shadow": mesh.cast_shadow})
	source.free()
	templates[product] = result
	return result

func update(franchise: Dictionary) -> void:
	for product in groups:
		var fixtures: Array = groups[product].filter(func(group): return group.node.is_visible_in_tree())
		for index in fixtures.size():
			var group: Dictionary = fixtures[index]
			var count := RetailLayout.distributed_fixture_quantity(franchise.shelves[product], index, fixtures.size())
			var capacity := RetailLayout.distributed_fixture_quantity(RetailLayout.retail_shelf_capacity_for_tier(franchise.stationTiers.get("shelves-1", franchise.shelvesLevel), product, franchise.unlockedAreas), index, fixtures.size())
			for label in group.labels:
				if "/" in label.text: label.text = "%d/%d" % [count, capacity]
				elif label.text == "LLENO" or label.text.begins_with("faltan "):
					label.text = "LLENO" if capacity > 0 and count >= capacity else "faltan %d" % maxi(0, capacity - count)
			var visual_count := mini(RetailLayout.RETAIL_VISUAL_CAPACITY[product], maxi(0, count))
			var key: int = group.node.get_instance_id()
			if _counts.get(key, -1) == visual_count: continue
			_counts[key] = visual_count
			if group.batches.is_empty() and visual_count > 0:
				for part in _template(product):
					var batch := MultiMeshInstance3D.new()
					batch.multimesh = MultiMesh.new()
					batch.multimesh.transform_format = MultiMesh.TRANSFORM_3D
					batch.multimesh.mesh = part.mesh
					batch.cast_shadow = part.shadow
					group.node.add_child(batch)
					group.batches.append({"node": batch, "transform": part.transform})
			for part in group.batches:
				var multimesh: MultiMesh = part.node.multimesh
				multimesh.instance_count = visual_count
				for ordinal in visual_count:
					var p := RetailLayout.retail_stock_landing_local_position(product, ordinal, visual_count)
					var tilt: float = RetailLayout.PRODUCE_DECK.tilt if product in ["tomatoes", "oranges", "apples", "corn"] else 0
					var scale_value := 0.9 if product in ["eggs", "tomatoes", "oranges", "apples", "corn"] else 0.92
					var transform := Transform3D(Basis(Vector3.RIGHT, tilt).scaled(Vector3.ONE * scale_value), Vector3(p[0], p[1], p[2]))
					multimesh.set_instance_transform(ordinal, transform * part.transform)
