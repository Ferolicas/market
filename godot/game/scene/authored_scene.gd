class_name AuthoredScene
extends Node3D
## Source React scene assembly exported by scripts/export-godot-scene.mjs.
## Geometry/materials keep their authored transforms in simulation space.
const Animal = preload("res://game/animation/animal_motion.gd")
var nodes: Dictionary = {}
var labels: Array[Label3D] = []
var animals: Array = []
var part: String
var manifest: Dictionary

## Per (part, phase) timing so a slow part (e.g. crops taking ~2x longer than
## furniture despite a smaller and fewer-manifest-entries .glb) can be
## attributed to loading the .glb, instantiating it, _index()'s recursive
## vertex-color scan, or the per-entry shadow/material loop, instead of
## guessed at. Folded into world.load_timings_ms (application.gd's
## startup-world-load telemetry report) after every part has loaded.
static var _load_phase_ms := {}

static func take_load_phase_stats() -> Dictionary:
	var stats := _load_phase_ms.duplicate()
	_load_phase_ms.clear()
	return stats

func load_part(part_name: String) -> void:
	part = part_name
	var phase_start := Time.get_ticks_msec()
	manifest = JSON.parse_string(FileAccess.get_file_as_string("res://assets/authored/%s.json" % part))
	var packed: PackedScene = load("res://assets/authored/%s.glb" % part)
	_load_phase_ms["%s_glbLoadMs" % part] = Time.get_ticks_msec() - phase_start
	phase_start = Time.get_ticks_msec()
	var content := packed.instantiate()
	add_child(content)
	_load_phase_ms["%s_instantiateMs" % part] = Time.get_ticks_msec() - phase_start
	phase_start = Time.get_ticks_msec()
	_index(content)
	_load_phase_ms["%s_indexMs" % part] = Time.get_ticks_msec() - phase_start
	phase_start = Time.get_ticks_msec()
	for entry in manifest.manifest:
		if nodes.has(entry.name):
			nodes[entry.name].set_meta("source_name", entry.sourceName)
			if entry.get("light") != null: nodes[entry.name].set_meta("three_light", entry.light)
			if entry.has("castShadow"):
				var targets: Array = [nodes[entry.name]] if nodes[entry.name] is MeshInstance3D else nodes[entry.name].find_children(entry.name + "_instance_*", "MeshInstance3D", true, false)
				for mesh in targets: mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if entry.castShadow else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			if entry.get("materials") != null:
				var material_targets: Array = [nodes[entry.name]] if nodes[entry.name] is MeshInstance3D else nodes[entry.name].find_children(entry.name + "_instance_*", "MeshInstance3D", true, false)
				for mesh in material_targets:
					for index in mini(mesh.mesh.get_surface_count(), entry.materials.size()):
						var material: Material = SourcePbr.source_material(mesh, index)
						if not material is StandardMaterial3D: continue
						material = material.duplicate()
						var authored: Dictionary = entry.materials[index]
						material.set_meta("three_receive_shadow", entry.get("receiveShadow", true))
						material.set_meta("three_tone_mapped", authored.get("toneMapped", true))
						material.set_meta("three_fog", authored.get("fog", true))
						material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA if authored.transparent else BaseMaterial3D.TRANSPARENCY_DISABLED
						# Keep source opacity independent of the linear-HDR transmission
						# contribution; SourcePbr applies both in the original order.
						material.set_meta("three_transmission", authored.get("transmission", 0.0))
						material.clearcoat_enabled = authored.get("clearcoat", 0.0) > 0
						material.clearcoat = authored.get("clearcoat", 0.0)
						material.clearcoat_roughness = authored.get("clearcoatRoughness", 0.0)
						material.albedo_color.a = authored.opacity
						material.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_OPAQUE_ONLY if authored.depthWrite else BaseMaterial3D.DEPTH_DRAW_DISABLED
						if authored.unshaded: material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
						mesh.set_surface_override_material(index, material)
			if entry.get("authored") != null: nodes[entry.name].set_meta("authored", entry.authored)
	_load_phase_ms["%s_entriesLoopMs" % part] = Time.get_ticks_msec() - phase_start
	for entry in manifest.labels:
		var label := Label3D.new()
		label.name = entry.name
		label.text = str(entry.text)
		label.font = preload("res://game/render/world_text.gd").font()
		label.font_size = 64
		label.pixel_size = float(entry.fontSize) / 64.0
		label.modulate = Color("#" + entry.color)
		label.outline_size = 0
		label.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if entry.get("anchorX", "left") == "left" else (HORIZONTAL_ALIGNMENT_RIGHT if entry.get("anchorX") == "right" else HORIZONTAL_ALIGNMENT_CENTER)
		label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER if entry.get("anchorY") == "middle" else (VERTICAL_ALIGNMENT_BOTTOM if entry.get("anchorY") == "bottom" else VERTICAL_ALIGNMENT_TOP)
		label.transform = from_three_matrix(entry.matrix)
		nodes[entry.parent].add_child(label)
		labels.append(label)
		nodes[entry.name] = label
	for entry in manifest.get("externalModels", []):
		var anchor: Node3D = nodes[entry.name]
		var actor: Node3D = (load(entry.path) as PackedScene).instantiate()
		anchor.add_child(actor)
		var players := actor.find_children("*", "AnimationPlayer", true, false)
		assert(players.size() == 1, "Source animal must have its original animation library")
		animals.append({"anchor": anchor, "kind": entry.kind, "player": players[0], "time": 4.0 if entry.kind == "cow" else 0.0, "clip": "", "active": false})

func _index(node: Node) -> void:
	nodes[str(node.name)] = node
	if node is MeshInstance3D and node.mesh != null:
		for surface in node.mesh.get_surface_count():
			# surface_get_arrays() decodes the entire vertex buffer just to
			# check whether a color channel is present — surface_get_format()
			# answers the same question from the format flags alone, with no
			# buffer decode. Vertex-color-heavy organic content (crop/fruit
			# meshes) walked this for every surface of every instance during
			# _ready()'s authored-scene load (crops_bind_ms in
			# market_world.gd's startup telemetry).
			if node.mesh.surface_get_format(surface) & Mesh.ARRAY_FORMAT_COLOR != 0:
				var material: Material = SourcePbr.source_material(node, surface)
				if material is StandardMaterial3D:
					material = material.duplicate()
					material.vertex_color_use_as_albedo = true
					node.set_surface_override_material(surface, material)
	for child in node.get_children(): _index(child)

static func from_three_matrix(matrix: Array) -> Transform3D:
	return Transform3D(Basis(Vector3(matrix[0], matrix[1], matrix[2]), Vector3(matrix[4], matrix[5], matrix[6]), Vector3(matrix[8], matrix[9], matrix[10])), Vector3(matrix[12], matrix[13], matrix[14]))

func _process(delta: float) -> void:
	for animal in animals:
		animal.time += minf(delta, 0.05)
		var motion := Animal.animal_motion(animal.kind, animal.time, animal.active)
		animal.anchor.position.x = motion.x
		animal.anchor.rotation.y = motion.yaw
		if animal.clip != motion.clip:
			animal.clip = motion.clip
			var player: AnimationPlayer = animal.player
			var clip: String = motion.clip
			if not player.has_animation(clip):
				for candidate in player.get_animation_list():
					if candidate.get_slice("/", candidate.get_slice_count("/") - 1) == clip:
						clip = candidate
						break
			assert(player.has_animation(clip), "Missing original animal animation: " + clip)
			player.play(clip, 0.18)

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		# Imported meshes can share materials across siblings. Detach their
		# render instances before hierarchy destruction releases those resources.
		for mesh in find_children("*", "MeshInstance3D", true, false):
			mesh.set_base(RID())
