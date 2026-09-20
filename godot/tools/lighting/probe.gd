extends RefCounted
static func apply(world: MarketWorld) -> void:
	var data: Array = JSON.parse_string(FileAccess.get_file_as_string("res://tools/lighting/dfg.json"))
	var bytes := PackedByteArray()
	bytes.resize(data.size() * 2)
	for index in data.size(): bytes.encode_u16(index * 2, int(data[index]))
	var lut := ImageTexture.create_from_image(Image.create_from_data(16, 16, false, Image.FORMAT_RGH, bytes))
	var env_data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tools/lighting/environment.json"))
	var env_bytes := PackedByteArray()
	env_bytes.resize(env_data.data.size() * 2)
	for index in env_data.data.size(): env_bytes.encode_u16(index * 2, int(env_data.data[index]))
	var env_map := ImageTexture.create_from_image(Image.create_from_data(env_data.width, env_data.height, false, Image.FORMAT_RGBAH, env_bytes))
	world.get_viewport().msaa_3d = Viewport.MSAA_4X
	world.environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	world.environment.ambient_light_energy = 0
	world.sun.light_energy = 2.3 / PI
	for mesh in world.find_children("*", "MeshInstance3D", true, false) + world.find_children("*", "MultiMeshInstance3D", true, false):
		var geometry: Mesh = mesh.mesh if mesh is MeshInstance3D else (mesh.multimesh.mesh if mesh.multimesh != null else null)
		if geometry == null: continue
		for index in geometry.get_surface_count():
			var material: Material = mesh.get_active_material(index) if mesh is MeshInstance3D else (mesh.material_override if mesh.material_override != null else geometry.surface_get_material(index))
			if not material is StandardMaterial3D: continue
			var shader := ShaderMaterial.new()
			var code := FileAccess.get_file_as_string("res://tools/lighting/single_pass.gdshader")
			if material.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED: code = code.replace("void fragment() {", "void fragment() { ALPHA = base_color.a;")
			if material.depth_draw_mode == BaseMaterial3D.DEPTH_DRAW_DISABLED: code = code.replace("render_mode ambient_light_disabled;", "render_mode ambient_light_disabled, depth_draw_never;")
			if material.cull_mode == BaseMaterial3D.CULL_DISABLED: code = code.replace("render_mode ambient_light_disabled", "render_mode cull_disabled, ambient_light_disabled")
			shader.shader = Shader.new()
			shader.shader.code = code
			shader.set_shader_parameter("unlit", material.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED)
			shader.set_shader_parameter("dfg_lut", lut)
			shader.set_shader_parameter("environment_map", env_map)
			shader.set_shader_parameter("base_color", material.albedo_color)
			if material.albedo_texture != null: shader.set_shader_parameter("color_map", material.albedo_texture)
			shader.set_shader_parameter("rough", material.roughness)
			shader.set_shader_parameter("metal", material.metallic)
			shader.set_shader_parameter("vertex_color", material.vertex_color_use_as_albedo)
			shader.set_shader_parameter("glow", material.emission * material.emission_energy_multiplier if material.emission_enabled else Color.BLACK)
			if mesh is MeshInstance3D: mesh.set_surface_override_material(index, shader)
			else: mesh.material_override = shader
