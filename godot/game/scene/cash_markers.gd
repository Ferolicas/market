class_name CashMarkerPresentation
extends Node3D
## PurchaseSquare and RegisterCashMarkers from the original MarketScene.
const Game = preload("res://game/engine.gd")
var markers: Dictionary = {}
var drawers: Array = []
var elapsed := 0.0
var highlighted := ""
var highlight_until := 0.0
var previous_franchise := ""
var previous_level := 0
var previous_available: Array = []

func _material(color: String, alpha: float = 1, unshaded: bool = false) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(color)
	material.albedo_color.a = alpha
	material.roughness = 0.85
	if alpha < 1: material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	if unshaded: material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return material

func _box(parent: Node3D, size: Vector3, position_value: Vector3, color: String) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	mesh.mesh = box
	mesh.position = position_value
	mesh.material_override = _material(color)
	mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mesh)
	return mesh

func _plane(parent: Node3D, size_value: float, height: float, color: String, alpha: float) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2.ONE * size_value
	mesh.mesh = plane
	mesh.position.y = height
	mesh.material_override = _material(color, alpha, true)
	mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mesh)
	return mesh

func _label(parent: Node3D, value: String, position_value: Vector3, size_value: float, color: String) -> Label3D:
	var label := Label3D.new()
	label.font = preload("res://game/render/world_text.gd").font()
	label.font_size = 64
	label.pixel_size = size_value / 64
	label.text = value
	label.position = position_value
	label.modulate = Color(color)
	label.outline_size = 0
	parent.add_child(label)
	return label

func update(game: Dictionary) -> void:
	var franchise := EngineProgression.current_franchise(game)
	var present := {}
	var quotes := Game.campaign_purchase_quotes(game)
	var available: Array = quotes.filter(func(quote): return quote.available).map(func(quote): return quote.id)
	var level := CampaignLevels.campaign_level(franchise)
	if previous_franchise != franchise.id:
		highlighted = ""
	elif level > previous_level and not available.is_empty():
		var fresh: Array = available.filter(func(id): return id not in previous_available)
		highlighted = fresh[0] if not fresh.is_empty() else available[0]
		highlight_until = elapsed + 9.0
	previous_franchise = franchise.id
	previous_level = level
	previous_available = available
	for quote in quotes:
		if not quote.available: continue
		present[quote.id] = true
		if quote.id not in markers: markers[quote.id] = _purchase(quote)
		var marker: Dictionary = markers[quote.id]
		marker.price.text = Game.format_money(quote.get("remainingMinor", 0), game)
		var funded: float = clampf(float(quote.contributedMinor) / quote.costMinor, 0, 1) if quote.costMinor > 0 else 0
		marker.fill.visible = funded > 0
		marker.fill.scale = Vector3(maxf(0.0001, funded), 1, maxf(0.0001, funded))
	for id in markers.keys():
		if id not in present:
			markers[id].root.queue_free()
			markers.erase(id)
	if drawers.is_empty():
		for lane in 3:
			var root := Node3D.new()
			var point := RegisterLayout.register_pickup_position(lane)
			root.position = Vector3(point[0] * 2, point[1], point[2] * 2)
			root.scale = Vector3.ONE * 1.6
			add_child(root)
			var stack := MultiMeshInstance3D.new()
			stack.multimesh = MultiMesh.new()
			stack.multimesh.transform_format = MultiMesh.TRANSFORM_3D
			var box := BoxMesh.new()
			box.size = Vector3(0.2, 0.05, 0.1)
			box.material = _material("#79b063")
			stack.multimesh.mesh = box
			stack.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			root.add_child(stack)
			var ring := MeshInstance3D.new()
			var mesh := ArrayMesh.new()
			var vertices := PackedVector3Array()
			for index in 32:
				var a := TAU * index / 32
				var b := TAU * (index + 1) / 32
				var outer_a := Vector3(cos(a), 0, sin(a)) * 0.48
				var inner_a := Vector3(cos(a), 0, sin(a)) * 0.42
				var outer_b := Vector3(cos(b), 0, sin(b)) * 0.48
				var inner_b := Vector3(cos(b), 0, sin(b)) * 0.42
				vertices.append_array([outer_a, outer_b, inner_a, inner_a, outer_b, inner_b])
			var arrays := []
			arrays.resize(Mesh.ARRAY_MAX)
			arrays[Mesh.ARRAY_VERTEX] = vertices
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
			ring.mesh = mesh
			ring.material_override = _material("#e8ca6b", 1, true)
			root.add_child(ring)
			drawers.append({"root": root, "stack": stack, "label": _label(root, "RECOGER", Vector3.ZERO, 0.13, "#28483e")})
	var bundle := CashBundles.cash_bundle_minor(Game.country_money_scale(game.countryCode))
	for lane in 3:
		var count := mini(CashBundles.CASH_BUNDLE_RENDER_CAP, CashBundles.cash_bundle_count(franchise.registerCashMinor[lane], bundle))
		var drawer: Dictionary = drawers[lane]
		drawer.root.visible = count > 0
		drawer.stack.multimesh.instance_count = count
		for index in count:
			var layer := floori(index / 9.0)
			var slot := index % 9
			drawer.stack.multimesh.set_instance_transform(index, Transform3D(Basis.IDENTITY, Vector3((slot % 3 - 1) * 0.22, 0.025 + layer * 0.054, (floori(slot / 3.0) - 1) * 0.12)))
		drawer.label.position.y = ceilf(count / 9.0) * 0.054 + 0.3

func _purchase(quote: Dictionary) -> Dictionary:
	var root := Node3D.new()
	var point: Array = PurchaseLayout.PURCHASE_POSITIONS[quote.id]
	root.position = Vector3(point[0] * 2, point[1], point[2] * 2)
	root.scale = Vector3.ONE * 1.6
	add_child(root)
	var pulse := Node3D.new()
	root.add_child(pulse)
	var rim := _plane(pulse, 0.68, 0.012, "#e8ca6b", 0.95)
	_plane(pulse, 0.58, 0.018, "#2e4a3f", 0.85)
	var fill := _plane(pulse, 0.58, 0.024, "#7fba63", 0.9)
	var sign_node := Node3D.new()
	sign_node.position.z = -0.62
	sign_node.rotation.y = atan2(16, 25.75)
	root.add_child(sign_node)
	_box(sign_node, Vector3(0.06, 1.18, 0.06), Vector3(0, 0.59, 0), "#4b5b56")
	var face := Node3D.new()
	face.position.y = 1.18 + 0.34
	face.rotation.x = -0.2
	sign_node.add_child(face)
	_box(face, Vector3(1.76, 0.84, 0.06), Vector3.ZERO, "#f4e4ad")
	_box(face, Vector3(1.64, 0.72, 0.001), Vector3(0, 0, 0.031), "#fff8e1")
	var label := _label(face, quote.label, Vector3(0, 0.2, 0.036), 0.15, "#2a4a3e")
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.width = 1.56 / label.pixel_size
	return {"root": root, "pulse": pulse, "rim": rim, "id": quote.id, "fill": fill, "price": _label(face, "", Vector3(0, -0.18, 0.036), 0.27, "#1f5c3b")}

func _process(delta: float) -> void:
	elapsed += delta
	if elapsed >= highlight_until: highlighted = ""
	for marker in markers.values():
		var highlighted_marker: bool = marker.id == highlighted
		SourcePbr.source_material(marker.rim).albedo_color = Color("#ffd75e" if highlighted_marker else "#e8ca6b", 0.95)
		var breath := 1 + sin(elapsed * 3.1) * (0.12 if highlighted_marker else 0.07)
		marker.pulse.scale = Vector3(breath, 1, breath)
