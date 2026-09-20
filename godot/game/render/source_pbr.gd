class_name SourcePbr
extends Node
## Three's lighting sum/ACES and original PMREM, adapted to native materials.
## Mutable StandardMaterial3D resources remain the presentation API; their
## touch() publishes numeric parameter edits (Godot does not emit changed for
## those setters), preserving the existing game-facing colour state.
const SOURCE_META := "market_source_material"
var scope: Node
var studio := false
var glass_transmission := true
var thumbnail := false
var studio_map: ImageTexture
var material_cache := {}
var shaders := {}
var light_signature := ""
var light_texture: ImageTexture
var light_data: Image
static var dfg: ImageTexture
static var environment_map: ImageTexture

static func source_material(mesh: GeometryInstance3D, surface: int = 0) -> Material:
	var material: Material
	if mesh is MeshInstance3D: material = mesh.get_active_material(surface)
	elif mesh is MultiMeshInstance3D and mesh.multimesh != null:
		material = mesh.material_override if mesh.material_override != null else mesh.multimesh.mesh.surface_get_material(surface)
	if material != null and material.has_meta(SOURCE_META):
		var source: Material = material.get_meta(SOURCE_META)
		var refresh: Callable = source.get_meta("market_pbr_refresh", Callable())
		if refresh.is_valid(): refresh.call_deferred()
		return source
	return material

static func touch(source: Material) -> void:
	var refresh: Callable = source.get_meta("market_pbr_refresh", Callable()) if source != null else Callable()
	if refresh.is_valid(): refresh.call()

static func _half_texture(values: Array, width: int, height: int, format: Image.Format) -> ImageTexture:
	var bytes := PackedByteArray()
	bytes.resize(values.size() * 2)
	for index in values.size(): bytes.encode_u16(index * 2, int(values[index]))
	return ImageTexture.create_from_image(Image.create_from_data(width, height, false, format, bytes))

func _ready() -> void:
	if dfg == null:
		dfg = _half_texture(JSON.parse_string(FileAccess.get_file_as_string("res://assets/lighting/three-dfg.json")), 16, 16, Image.FORMAT_RGH)
		var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/lighting/market-environment.json"))
		environment_map = _half_texture(data.data, data.width, data.height, Image.FORMAT_RGBAH)
	if studio:
		var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/lighting/thumbnail-environment.json" if thumbnail else "res://assets/lighting/preview-environment.json"))
		studio_map = _half_texture(data.data, data.width, data.height, Image.FORMAT_RGBAH)
	light_texture = ImageTexture.create_from_image(Image.create_empty(32, 3, false, Image.FORMAT_RGBAF))
	if not studio: RenderingServer.global_shader_parameter_set("market_light_data", light_texture)
	get_tree().node_added.connect(_node_added)
	for mesh in scope.find_children("*", "GeometryInstance3D", true, false): _bind_node(mesh)

func _node_added(node: Node) -> void:
	if (node is GeometryInstance3D) and is_instance_valid(scope) and scope.is_ancestor_of(node):
		_bind_reference.call_deferred(weakref(node))

func _bind_reference(reference: WeakRef) -> void:
	var node = reference.get_ref()
	if is_instance_valid(node): _bind_node(node)

func _bind_node(node: Node) -> void:
	if not is_instance_valid(node) or not is_instance_valid(scope) or not scope.is_ancestor_of(node): return
	if not studio: node.layers = 3
	var geometry: Mesh
	if node is MeshInstance3D: geometry = node.mesh
	elif node is MultiMeshInstance3D and node.multimesh != null: geometry = node.multimesh.mesh
	if geometry == null: return
	# Godot queries instance uniforms while destroying a mesh; disconnect its
	# rendering base before its last material reference is released.
	if node.get_meta("market_pbr_detach", 0) != node.get_instance_id():
		for connection in node.tree_exiting.get_connections():
			var callback: Callable = connection.callable
			if callback.get_method() == "_detach_node": node.tree_exiting.disconnect(callback)
		node.tree_exiting.connect(_detach_node.bind(weakref(node)))
		node.set_meta("market_pbr_detach", node.get_instance_id())
	node.set_base(geometry.get_rid() if node is MeshInstance3D else node.multimesh.get_rid())
	for index in geometry.get_surface_count():
		var source: Material = source_material(node, index)
		if not source is StandardMaterial3D: continue
		if not studio and source.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA: node.layers = 1
		var id := source.get_instance_id()
		var material: ShaderMaterial
		if id in material_cache: material = material_cache[id].get_ref()
		if material == null:
			material = ShaderMaterial.new()
			material.set_meta(SOURCE_META, source)
			material_cache[id] = weakref(material)
			var previous_refresh: Callable = source.get_meta("market_pbr_refresh", Callable())
			if previous_refresh.is_valid() and source.changed.is_connected(previous_refresh): source.changed.disconnect(previous_refresh)
			source.set_meta("market_pbr_refresh", _sync_material.bind(weakref(source), weakref(material)))
			_sync_material(weakref(source), weakref(material))
			source.changed.connect(_sync_material.bind(weakref(source), weakref(material)))
		if node is MeshInstance3D and node.material_override == null: node.set_surface_override_material(index, material)
		else: node.material_override = material

func _detach_node(reference: WeakRef) -> void:
	var node = reference.get_ref()
	if is_instance_valid(node): node.set_base(RID())

func _variant(source: StandardMaterial3D) -> Shader:
	var key := str([source.transparency, source.depth_draw_mode, source.cull_mode, source.normal_enabled and source.normal_texture != null, source.get_meta("three_transmission", 0.0) > 0.0, source.shading_mode])
	if key in shaders: return shaders[key]
	var code := FileAccess.get_file_as_string("res://game/render/three_pbr.gdshader")
	if source.get_meta("three_transmission", 0.0) > 0.0:
		code = code.replace("// TRANSMISSION_DECLARATIONS", '#include "res://game/render/three_transmission.gdshaderinc"')
		code = code.replace("// TRANSMISSION_FRAGMENT", "transmission_uv = SCREEN_UV;")
		code = code.replace("// TRANSMISSION_LIGHT", "radiance += transmission_sample(transmission_uv, surface_roughness)*ALBEDO*(1.0-surface_metal)*(1.0-(f0*dfg_v.x+f90*dfg_v.y))*transmission_amount;")
	if not source.normal_enabled or source.normal_texture == null:
		code = code.replace("if (has_normal) { NORMAL_MAP = texture(normal_map,material_uv).rgb; NORMAL_MAP_DEPTH = normal_strength; }", "")
	if source.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED:
		var alpha := "ALPHA = base_color.a * texel.a;"
		if source.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR: alpha += " ALPHA_SCISSOR_THRESHOLD = alpha_threshold;"
		code = code.replace("// ALPHA_OUTPUT", alpha)
	if source.depth_draw_mode == BaseMaterial3D.DEPTH_DRAW_DISABLED: code = code.replace("render_mode ambient_light_disabled;", "render_mode ambient_light_disabled, depth_draw_never;")
	if source.cull_mode == BaseMaterial3D.CULL_DISABLED:
		code = code.replace("render_mode ambient_light_disabled", "render_mode cull_disabled, ambient_light_disabled")
		code = code.replace("void fragment() {", "void fragment() { if (!FRONT_FACING) NORMAL = -NORMAL;")
	elif source.cull_mode == BaseMaterial3D.CULL_FRONT: code = code.replace("render_mode ambient_light_disabled", "render_mode cull_front, ambient_light_disabled")
	if source.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED:
		code = code.replace("render_mode ambient_light_disabled", "render_mode unshaded, ambient_light_disabled")
		code = code.replace("// UNLIT_OUTPUT", """
 vec3 basic = material_base;
 if(mapped_tone && linear_pass<0.5) basic=aces(basic);
 if(use_fog && !studio){
  float factor=smoothstep(186.0,315.0,fog_depth);
  if(linear_pass>0.5) basic=mix(basic,OUTPUT_IS_SRGB?to_linear(market_fog.rgb):market_fog.rgb,factor);
  else basic=to_linear(mix(to_srgb(basic),OUTPUT_IS_SRGB?market_fog.rgb:to_srgb(market_fog.rgb),factor));
 }
 ALBEDO=OUTPUT_IS_SRGB?compatibility_input(compatibility_output(linear_pass>0.5?basic:to_srgb(basic))):basic;
""")
	var shader := Shader.new()
	shader.code = code
	shaders[key] = shader
	return shader

static func _channel(channel: int) -> Vector4:
	if channel == BaseMaterial3D.TEXTURE_CHANNEL_GRAYSCALE: return Vector4(1.0 / 3, 1.0 / 3, 1.0 / 3, 0)
	var result := Vector4.ZERO
	result[channel] = 1
	return result

func set_glass_transmission(enabled: bool) -> void:
	glass_transmission = enabled
	for reference in material_cache.values():
		var material: ShaderMaterial = reference.get_ref()
		if material != null: _sync_material(weakref(material.get_meta(SOURCE_META)), reference)

func _sync_material(source_ref: WeakRef, shader_ref: WeakRef) -> void:
	var source: StandardMaterial3D = source_ref.get_ref()
	var material: ShaderMaterial = shader_ref.get_ref()
	if source == null or material == null: return
	var shader := _variant(source)
	if material.shader != shader: material.shader = shader
	var base_color := source.albedo_color
	var values := {
		"base_color": base_color, "transmission_amount": source.get_meta("three_transmission", 0.0) if glass_transmission else 0.0, "color_map": source.albedo_texture,
		"dfg_lut": dfg, "environment_map": studio_map if studio else environment_map,
		"studio": studio, "studio_ambient": 1.5 if thumbnail else 1.45,
		"environment_intensity": 0.4 if thumbnail else (0.42 if studio else 0.28),
		"environment_max_mip": 5.0 if thumbnail else 6.0,
		"environment_texel": Vector2(1.0 / 336.0, 1.0 / (128.0 if thumbnail else 256.0)),
		"rough": source.roughness, "metal": source.metallic,
		"coat": source.clearcoat if source.clearcoat_enabled else 0.0,
		"coat_rough": source.clearcoat_roughness,
		"specular_intensity": source.get_meta("three_specular_intensity", 1.0),
		"sheen_color": Color(source.get_meta("three_sheen_color", "ffffff")),
		"sheen": source.get_meta("three_sheen", 0.0),
		"sheen_rough": source.get_meta("three_sheen_roughness", 1.0),
		"roughness_map": source.roughness_texture, "metallic_map": source.metallic_texture,
		"roughness_channel": _channel(source.roughness_texture_channel), "metallic_channel": _channel(source.metallic_texture_channel),
		"vertex_color": source.vertex_color_use_as_albedo,
		"unlit": source.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED,
		"glow": source.emission if source.emission_enabled else Color.BLACK,
		"emission_energy": source.emission_energy_multiplier if source.emission_enabled else 0.0,
		"emission_map": source.emission_texture, "emission_has_map": source.emission_texture != null,
		"emission_multiply": source.emission_operator == BaseMaterial3D.EMISSION_OP_MULTIPLY,
		"has_normal": source.normal_enabled and source.normal_texture != null,
		"normal_map": source.normal_texture, "normal_strength": source.normal_scale,
		"occlusion_map": source.ao_texture if source.ao_enabled else null,
		"occlusion_channel": _channel(source.ao_texture_channel), "occlusion_uv2": source.ao_on_uv2,
		"uv_scale": source.uv1_scale, "uv_offset": source.uv1_offset,
		"receive_shadows": source.get_meta("three_receive_shadow", not source.disable_receive_shadows),
		"mapped_tone": source.get_meta("three_tone_mapped", true), "use_fog": source.get_meta("three_fog", true),
		"alpha_threshold": source.alpha_scissor_threshold,
	}
	var previous: Dictionary = material.get_meta("market_last_values", {})
	for key in values:
		if not previous.has(key) or previous[key] != values[key]: material.set_shader_parameter(key, values[key])
	material.set_meta("market_last_values", values)
	material.render_priority = source.render_priority

func update_daylight(daylight: Dictionary) -> void:
	RenderingServer.global_shader_parameter_set("market_ambient", daylight.ambientIntensity)
	RenderingServer.global_shader_parameter_set("market_fog", Color(daylight.fog))

func _process(_delta: float) -> void:
	if studio: return
	var entries: Array = []
	for light in scope.find_children("*", "OmniLight3D", true, false):
		if not light.is_visible_in_tree(): continue
		var source: Dictionary = light.get_meta("three_light", {})
		var color: Color = Color(source.color) if source.has("color") else light.light_color
		entries.append([light.global_position, source.get("distance", light.omni_range), color.srgb_to_linear(), source.get("intensity", light.light_energy * PI), source.get("decay", 2.0)])
	var signature := str(entries)
	if signature == light_signature: return
	light_signature = signature
	var image := Image.create_empty(32, 3, false, Image.FORMAT_RGBAF)
	for index in mini(32, entries.size()):
		var entry: Array = entries[index]
		image.set_pixel(index, 0, Color(entry[0].x, entry[0].y, entry[0].z, entry[1]))
		image.set_pixel(index, 1, Color(entry[2].r, entry[2].g, entry[2].b, entry[3]))
		image.set_pixel(index, 2, Color(entry[4], 0, 0, 0))
	light_data = image
	light_texture.update(light_data)
	RenderingServer.global_shader_parameter_set("market_light_count", mini(32, entries.size()))
