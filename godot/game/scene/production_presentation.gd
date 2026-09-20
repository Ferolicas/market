class_name ProductionPresentation
extends Node3D
## Live MarketKit machine boards, output products, process lights and animal trays.
var machines := {}
var animals := {}
var templates := {}

func _ready() -> void:
	var library := AuthoredScene.new()
	library.visible = false
	add_child(library)
	library.load_part("retail-products")
	for node in library.nodes.values():
		var label: String = node.get_meta("source_name", "")
		if label.begins_with("retail-template:"): templates[label.trim_prefix("retail-template:")] = node

func bind(furniture: AuthoredScene, farm: AuthoredScene) -> void:
	for node in furniture.nodes.values():
		if not is_instance_valid(node) or node.get_meta("source_name", "") != "dynamic:machine-status": continue
		var anchor := _fixture_anchor(node)
		if anchor == null: continue
		var position_value: Array = anchor.get_meta("authored").authoredPosition
		for fixture in ProductionLayout.STORE_PRODUCTION_FIXTURES.values():
			if not _same_position(position_value, fixture.position): continue
			var output: Node3D
			var indicator: MeshInstance3D
			for candidate in anchor.find_children("*", "Node3D", true, false):
				if candidate.get_meta("source_name", "") == "dynamic:machine-output": output = candidate
				if fixture.fixtureId == "cornCanner" and candidate is MeshInstance3D and candidate.position.distance_to(Vector3(0.44, 0.85, 0.012)) < 0.0001: indicator = candidate
			var light: OmniLight3D
			if fixture.fixtureId in ["breadOven", "cheeseMaker", "juiceMachine"]:
				light = OmniLight3D.new()
				light.position = Vector3(0, 0.95, 0.52) if fixture.fixtureId == "breadOven" else Vector3(0, 0.65, 0.45)
				light.omni_range = 2.2 if fixture.fixtureId == "breadOven" else 1.6
				light.light_energy = (0.8 if fixture.fixtureId == "breadOven" else 0.45) / PI
				light.light_color = Color({"breadOven": "df8b43", "cheeseMaker": "ffd75c", "juiceMachine": "ff6b43"}[fixture.fixtureId])
				anchor.add_child(light)
			machines[fixture.machineId] = {"labels": node.find_children("*", "Label3D", true, false), "bulb": node.find_children("*", "MeshInstance3D", true, false)[0], "output": output, "last_output": -1, "light": light, "indicator": indicator}
	for node in farm.nodes.values():
		if not is_instance_valid(node) or node.get_meta("source_name", "") != "dynamic:farm-animal": continue
		var anchor := _fixture_anchor(node)
		if anchor == null: continue
		var position_value: Array = anchor.get_meta("authored").authoredPosition
		for id in ["chicken", "chicken2", "cow"]:
			if not _same_position(position_value, FarmLayout.FARM_ANIMAL_STATIONS[id].position): continue
			var output: Node3D
			for candidate in node.find_children("*", "Node3D", true, false):
				if candidate.get_meta("source_name", "") == "dynamic:animal-output": output = candidate
			animals[{"chicken": "chicken-coop-1", "chicken2": "chicken-coop-2", "cow": "cow-station-1"}[id]] = {"labels": node.find_children("*", "Label3D", true, false), "output": output}

func update(franchise: Dictionary) -> void:
	for id in machines:
		var view: Dictionary = machines[id]
		var machine: Variant = EngineProgression.find_id(franchise.productionMachines, id)
		var output: int = machine.output if machine != null else 0
		var status := machine_status(machine)
		var recipe: Dictionary = Products.config_value(machine.productId, "recipe", {}) if machine != null else {}
		var ingredient: String = recipe.keys()[0] if not recipe.is_empty() else ""
		var queued: int = machine.input.get(ingredient, 0) + (recipe.get(ingredient, 0) if machine.status == "PROCESSING" else 0) if machine != null else 0
		view.labels[1].text = "%s/%s" % [output, machine.outputCapacity if machine != null else 0]
		view.labels[1].modulate = Color("8ce6a1" if output > 0 else "ffffff")
		view.labels[2].text = Catalog.PRODUCTS[ingredient].name.to_upper() if not ingredient.is_empty() else "COLA"
		view.labels[3].text = "%s/%s" % [queued, StationSystem.machine_input_capacity(machine, ingredient) if machine != null and not ingredient.is_empty() else 0]
		view.labels[3].modulate = Color("ffd98a" if queued > 0 else "ffffff")
		view.labels[4].text = status.label
		view.labels[4].modulate = Color(status.color)
		SourcePbr.source_material(view.bulb, 0).albedo_color = Color(status.color)
		var processing: bool = machine != null and machine.status == "PROCESSING"
		if view.light != null: view.light.visible = processing
		if view.indicator != null: SourcePbr.source_material(view.indicator, 0).albedo_color = Color("77e686" if processing else "d1ae56")
		if view.output != null and view.last_output != output:
			view.last_output = output
			for child in view.output.get_children(): child.free()
			for index in mini(4, output):
				var product: Node3D = templates[machine.productId].duplicate()
				view.output.add_child(product)
				if machine.productId == "cannedCorn": product.position = Vector3(-0.4 + index * 0.2, 1.26, -0.3)
				else:
					product.position = Vector3(0.34 + (index % 2) * 0.13, 0.16 + floorf(index / 2.0) * 0.12, 0.45)
					product.scale = Vector3.ONE * 0.8
	for id in animals:
		var machine: Variant = EngineProgression.find_id(franchise.productionMachines, id)
		if machine == null: continue
		var view: Dictionary = animals[id]
		var feed := StationSystem.chicken_feed_status(machine)
		view.labels[2].text = "%s/%s" % [feed.occupied, feed.capacity]
		view.labels[2].modulate = Color("ffb27a" if feed.occupied == 0 else "ffffff")
		view.labels[4].text = "%s/%s" % [machine.output, machine.outputCapacity]
		view.labels[4].modulate = Color("8ce6a1" if machine.output > 0 else "ffffff")
		view.output.visible = machine.output > 0

static func machine_status(machine: Variant) -> Dictionary:
	if machine == null or machine.status == "LOCKED": return {"label": "BLOQUEADA", "color": "#9ea7a3"}
	if machine.output > 0 or machine.status in ["OUTPUT_READY", "FULL"]: return {"label": "RECOGER", "color": "#54d998"}
	if machine.status == "PROCESSING": return {"label": "EN PROCESO", "color": "#f0ad55"}
	return {"label": "CARGAR", "color": "#7fc8e8"}

static func _fixture_anchor(node: Node) -> Node3D:
	var parent := node.get_parent()
	while parent != null:
		if parent.has_meta("authored"): return parent
		parent = parent.get_parent()
	return null

static func _same_position(a: Array, b: Array) -> bool:
	return Vector3(a[0], a[1], a[2]).distance_to(Vector3(b[0], b[1], b[2])) < 0.001
