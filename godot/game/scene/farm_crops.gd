class_name FarmCropPresentation
extends RefCounted
## Uses all five exact source canopy stages and the original remaining-fruit slots.
const Authored = preload("res://game/scene/authored_scene.gd")
const KINDS = {"tomatoes": "tomato", "oranges": "orange", "apples": "apple", "wheat": "wheat", "corn": "corn", "coffee": "coffee"}
var library: Authored
var templates: Dictionary = {}
var plots: Dictionary = {}
var clock := 0.0

func bind(farm: Authored) -> void:
	library = Authored.new()
	library.load_part("crops")
	for node in library.nodes.values():
		var source_name: String = node.get_meta("source_name", "")
		if source_name.begins_with("crop:"): templates[source_name] = node
	for entry in farm.manifest.manifest:
		if entry.get("authored") == null: continue
		var position: Array = entry.authored.authoredPosition
		for plot in FarmLayout.FARM_PLOTS:
			if Vector3(position[0], position[1], position[2]).distance_to(Vector3(plot.position[0], plot.position[1], plot.position[2])) > 0.01: continue
			var anchor: Node3D = farm.nodes[entry.name]
			for child in anchor.get_children():
				anchor.remove_child(child)
				child.queue_free()
			plots[plot.id] = {"anchor": anchor, "accent": plot.accent, "key": "", "node": null, "fruits": [], "labels": [], "glow": null}

func dispose() -> void:
	if is_instance_valid(library): library.free()
	library = null
	templates.clear()

func update(franchise: Dictionary, now_ms: float) -> void:
	for id in plots:
		var plot: Dictionary = plots[id]
		var crop: Variant = EngineProgression.find_id(franchise.crops, id)
		var locked: bool = crop == null or crop.status == "LOCKED"
		plot.anchor.visible = not locked or not "purchase-campaign" in franchise.unlockedAreas
		if not plot.anchor.visible: continue
		var progress: float = 0 if locked else StationSystem.crop_progress(crop, now_ms)
		var stage: String = "LOCKED" if locked else (crop.status if crop.status in ["READY", "EMPTY"] else str(clampi(int(floor(progress * 4)), 0, 3)))
		var key: String = "crop:LOCKED" if locked else "crop:%s:%s" % [KINDS[crop.productId], stage]
		if key != plot.key:
			if plot.node != null: plot.node.free()
			plot.node = templates[key].duplicate()
			plot.anchor.add_child(plot.node)
			plot.key = key
			plot.fruits = []
			plot.labels = plot.node.find_children("*", "Label3D", true, false)
			plot.glow = null
			for node in plot.node.find_children("*", "Node3D", true, false):
				if node.get_meta("source_name", "") == "crop-fruits": plot.fruits = node.find_children("*", "MeshInstance3D", true, false)
				if node.get_meta("source_name", "") == "crop-ready-glow":
					plot.glow = node
					for mesh in node.find_children("*", "MeshInstance3D", true, false):
						for surface in mesh.mesh.get_surface_count():
							var material: StandardMaterial3D = SourcePbr.source_material(mesh, surface).duplicate()
							var opacity := material.albedo_color.a
							material.albedo_color = Color(plot.accent, opacity)
							mesh.set_surface_override_material(surface, material)
		if locked: continue
		var capacity := StationSystem.crop_harvest_yield(crop.productId, crop.tier, crop.get("baseYield"))
		for label in plot.labels:
			if "/" in label.text:
				label.text = "%d/%d" % [crop.available, capacity]
				label.modulate = Color("8ce6a1" if crop.available > 0 else "ffffff")
			elif "%" in label.text: label.text = "%d %%" % JS.round(clampf(progress, 0, 1) * 100)
		if crop.status == "READY":
			var visible_slots := CropVisual.crop_visual_slot_indices(crop.available, capacity, plot.fruits.size())
			for index in plot.fruits.size(): plot.fruits[index].visible = index in visible_slots
			if plot.glow != null: plot.glow.visible = crop.available > 0

func animate(delta: float) -> void:
	clock += delta
	var pulse := (sin(clock * 2.25) + 1) / 2
	for plot in plots.values():
		if plot.glow == null or not plot.glow.visible: continue
		var ring: MeshInstance3D = plot.glow.get_child(0)
		ring.rotation.z = clock * 0.16
		ring.scale = Vector3.ONE * (0.96 + pulse * 0.045)
		var material: StandardMaterial3D = SourcePbr.source_material(ring, 0)
		material.albedo_color.a = 0.17 + pulse * 0.11
