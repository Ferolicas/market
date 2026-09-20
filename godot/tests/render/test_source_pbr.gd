extends TestCase
var scope: Node3D
var mesh: MeshInstance3D
var source: StandardMaterial3D
var adapter: SourcePbr

func before_each() -> void:
	scope = Node3D.new()
	mesh = MeshInstance3D.new()
	mesh.mesh = BoxMesh.new()
	source = StandardMaterial3D.new()
	mesh.material_override = source
	scope.add_child(mesh)
	Engine.get_main_loop().root.add_child(scope)
	adapter = SourcePbr.new()
	adapter.scope = scope
	scope.add_child(adapter)

func after_each() -> void: scope.free()

func test_material_edits_reach_real_shader_without_replacing_game_material() -> void:
	assert_true(mesh.material_override is ShaderMaterial)
	assert_eq(SourcePbr.source_material(mesh), source)
	source.albedo_color = Color("72e8a9")
	source.emission_enabled = true
	source.emission = Color("2fac74")
	source.emission_energy_multiplier = 1.35
	SourcePbr.touch(source)
	assert_eq(mesh.material_override.get_shader_parameter("base_color"), source.albedo_color)
	assert_eq(mesh.material_override.get_shader_parameter("glow"), source.emission)
	assert_eq(mesh.material_override.get_shader_parameter("emission_energy"), 1.35)
	assert_false(mesh.material_override.shader.code.contains("NORMAL_MAP ="))

func test_source_environment_keeps_half_float_atlas_and_dfg_precision() -> void:
	assert_eq(SourcePbr.environment_map.get_size(), Vector2(336, 256))
	assert_eq(SourcePbr.environment_map.get_image().get_format(), Image.FORMAT_RGBAH)
	assert_eq(SourcePbr.dfg.get_size(), Vector2(16, 16))
	assert_eq(SourcePbr.dfg.get_image().get_format(), Image.FORMAT_RGH)

func test_point_light_data_preserves_source_intensity_range_decay_and_visibility() -> void:
	var light := OmniLight3D.new()
	light.position = Vector3(2, 3, 4)
	light.set_meta("three_light", {"color": "fff0d2", "intensity": 0.72, "distance": 5.8, "decay": 1.7})
	scope.add_child(light)
	adapter._process(0)
	var data := adapter.light_data
	assert_eq(data.get_pixel(0, 0), Color(2, 3, 4, 5.8))
	assert_near(data.get_pixel(0, 1).a, 0.72)
	assert_near(data.get_pixel(0, 2).r, 1.7)
	light.visible = false
	adapter._process(0)
	assert_eq(adapter.light_data.get_pixel(0, 0), Color(0, 0, 0, 0))

func test_cloned_mesh_detaches_its_own_renderer_and_releases_unique_material() -> void:
	var clone := mesh.duplicate() as MeshInstance3D
	clone.material_override = StandardMaterial3D.new()
	scope.add_child(clone)
	adapter._bind_node(clone)
	assert_eq(clone.get_meta("market_pbr_detach"), clone.get_instance_id())
	var material: WeakRef = weakref(clone.material_override)
	clone.free()
	assert_null(material.get_ref(), "Cache must not retain a departed actor's material")
	assert_eq(mesh.get_base(), mesh.mesh.get_rid(), "Freeing clone must not detach the original mesh")

func test_mobile_glass_keeps_authored_opacity_when_transmission_is_disabled() -> void:
	source.albedo_color = Color(0.8, 0.9, 0.85, 0.28)
	source.set_meta("three_transmission", 0.5)
	adapter.set_glass_transmission(false)
	assert_near(mesh.material_override.get_shader_parameter("base_color").a, 0.28)
	assert_near(source.albedo_color.a, 0.28, 0.000001, "Render policy cannot overwrite authored material")

func test_desktop_glass_keeps_opacity_and_uses_linear_transmission_shader() -> void:
	source.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	source.albedo_color.a = 0.28
	source.set_meta("three_transmission", 0.5)
	adapter.set_glass_transmission(true)
	adapter._bind_node(mesh)
	assert_near(mesh.material_override.get_shader_parameter("base_color").a, 0.28)
	assert_near(mesh.material_override.get_shader_parameter("transmission_amount"), 0.5)
	assert_true(mesh.material_override.shader.code.contains("three_transmission.gdshaderinc"))
	assert_eq(mesh.layers, 1, "Glass must not feed back into its own opaque buffer")
