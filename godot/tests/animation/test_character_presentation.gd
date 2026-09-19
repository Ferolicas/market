extends TestCase

var _roots: Array = []

func after_each() -> void:
	for root in _roots: root.free()
	_roots.clear()

func _character_fixture() -> Dictionary:
	var root := Node3D.new()
	_roots.append(root)
	var material := StandardMaterial3D.new()
	material.roughness = 0.94
	material.metallic = 0.4
	material.resource_name = "CharacterAtlas"
	var body := MeshInstance3D.new()
	body.mesh = BoxMesh.new()
	body.material_override = null
	body.mesh.surface_set_material(0, material)
	root.add_child(body)
	for side in ["L", "R"]:
		var foot := Node3D.new()
		foot.name = "Foot_%s" % side
		root.add_child(foot)
	return { "root": root, "material": material }

func _body(model: Node3D) -> MeshInstance3D:
	for child in model.get_children():
		if child is MeshInstance3D: return child
	return null

func _prepare(root: Node3D, options: Dictionary = {}) -> Node3D:
	var model := CharacterPresentation.prepare_character_model(root, options)
	_roots.append(model)
	return model

func test_closes_both_shoes_and_applies_a_soft_front_sided_finish_without_mutating_the_glb_cache() -> void:
	var fixture := _character_fixture()
	var source_material: StandardMaterial3D = fixture.material
	var model := _prepare(fixture.root, { "repairOpenSoles": true })
	var material := _body(model).get_surface_override_material(0)
	assert_true(material is StandardMaterial3D)
	assert_false(is_same(material, source_material))
	assert_eq(material.cull_mode, BaseMaterial3D.CULL_BACK)
	assert_gte(material.roughness, 0.54)
	assert_lte(material.roughness, 0.68)
	assert_near(material.clearcoat, 0.1, 0.005)
	assert_true(material.clearcoat_enabled)
	assert_eq(source_material.cull_mode, BaseMaterial3D.CULL_BACK)
	assert_near(source_material.roughness, 0.94, 0.005)
	assert_true(model.find_child("PremiumSole_L", true, false) is MeshInstance3D)
	assert_true(model.find_child("PremiumSole_R", true, false) is MeshInstance3D)

func test_keeps_only_thin_eyelash_cards_two_sided() -> void:
	var root := Node3D.new()
	_roots.append(root)
	var eyelash := StandardMaterial3D.new()
	eyelash.resource_name = "Eyelash.001"
	var body := StandardMaterial3D.new()
	body.resource_name = "CharacterAtlas"
	var card := MeshInstance3D.new()
	card.mesh = PlaneMesh.new()
	card.mesh.surface_set_material(0, eyelash)
	var shell := MeshInstance3D.new()
	shell.mesh = BoxMesh.new()
	shell.mesh.surface_set_material(0, body)
	root.add_child(card)
	root.add_child(shell)
	var model := _prepare(root)
	var materials := JS.map(model.get_children(), func(child): return child.get_surface_override_material(0))
	assert_eq(materials[0].cull_mode, BaseMaterial3D.CULL_DISABLED)
	assert_eq(materials[1].cull_mode, BaseMaterial3D.CULL_BACK)

func test_keeps_conservative_mesh_culling_and_disables_dynamic_shadows_for_reduced_actors() -> void:
	var model := _prepare(_character_fixture().root, { "reducedDetail": true })
	var body := _body(model)
	assert_eq(body.cast_shadow, GeometryInstance3D.SHADOW_CASTING_SETTING_OFF)
	assert_gte(body.custom_aabb.size.x / 2.0, 2.4)
	assert_gte(body.custom_aabb.get_longest_axis_size() / 2.0, 2.4)

func test_disposes_the_instance_finish_but_preserves_shared_sole_resources() -> void:
	var model := _prepare(_character_fixture().root, { "repairOpenSoles": true })
	var sole: MeshInstance3D = model.find_child("PremiumSole_L", true, false)
	var sole_material := sole.material_override
	assert_eq(CharacterPresentation.dispose_character_materials(model), 1)
	assert_null(_body(model).get_surface_override_material(0))
	assert_true(is_same(sole.material_override, sole_material))
	assert_true(sole_material.get_meta(CharacterPresentation.SHARED_RESOURCE_META, false))

func _rubber_insert(build: String) -> void:
	var model := _prepare(_character_fixture().root, { "build": build, "repairOpenSoles": true })
	var left: MeshInstance3D = model.find_child("PremiumSole_L", true, false)
	var right: MeshInstance3D = model.find_child("PremiumSole_R", true, false)
	var profile: Dictionary = CharacterPresentation.CHARACTER_SOLE_PROFILES[build]
	var size := left.mesh.get_aabb().size
	var material: StandardMaterial3D = left.material_override
	assert_near(size.x, profile.width, 1e-5, build)
	assert_near(size.y, profile.thickness, 1e-5, build)
	assert_near(size.z, profile.length, 1e-5, build)
	assert_gt(profile.length / profile.width, 1.5, build)
	assert_lt(profile.length / profile.width, 1.7, build)
	assert_lt(profile.thickness / profile.length, 0.11, build)
	assert_eq(left.position.z, 0.0, build)
	assert_eq(right.position.z, 0.0, build)
	assert_true(is_same(left.mesh, right.mesh), build)
	assert_true(is_same(left.material_override, right.material_override), build)
	assert_eq(material.metallic, 0.0, build)
	assert_gte(material.roughness, 0.8, build)

func test_keeps_the_adult_rubber_insert_centred_thin_and_inside_an_anatomical_shoe_silhouette() -> void: _rubber_insert("adult")
func test_keeps_the_child_rubber_insert_centred_thin_and_inside_an_anatomical_shoe_silhouette() -> void: _rubber_insert("child")

func test_does_not_duplicate_the_rigged_outsole_already_baked_into_current_market_characters() -> void:
	var model := _prepare(_character_fixture().root)
	assert_null(model.find_child("PremiumSole_L", true, false))
	assert_null(model.find_child("PremiumSole_R", true, false))

func test_prepares_a_shared_atlas_once_for_an_oblique_camera_without_cloning_its_texture() -> void:
	var fixture := _character_fixture()
	var atlas := ImageTexture.create_from_image(Image.create_empty(4, 4, false, Image.FORMAT_RGB8))
	fixture.material.albedo_texture = atlas
	fixture.material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	var first := _prepare(fixture.root)
	var second := _prepare(fixture.root, { "crowd": true })
	var first_material: StandardMaterial3D = _body(first).get_surface_override_material(0)
	var second_material: StandardMaterial3D = _body(second).get_surface_override_material(0)
	assert_true(is_same(first_material.albedo_texture, atlas))
	assert_true(is_same(second_material.albedo_texture, atlas))
	assert_eq(first_material.texture_filter, BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC)
	var filter := CharacterPresentation.character_map_filter(false, 1, 1)
	assert_gte(filter.anisotropy, 8)
	assert_eq(filter.magFilter, "linear")
	assert_eq(filter.minFilter, "linear-mipmap-linear")
	assert_true(filter.generateMipmaps)
	assert_true(first_material.emission_enabled)
	assert_near(first_material.emission_energy_multiplier, 0.055, 1e-6)
	assert_near(second_material.emission_energy_multiplier, 0.075, 1e-6)

func test_does_not_request_runtime_mipmap_generation_for_compressed_character_maps() -> void:
	var filter := CharacterPresentation.character_map_filter(true, 1, 1)
	assert_gte(filter.anisotropy, 8)
	assert_false(filter.generateMipmaps)
	assert_eq(filter.minFilter, "linear")

func test_selects_lods_from_live_pointer_hardware_and_viewport_capabilities() -> void:
	assert_eq(CharacterPresentation.character_model_tier_for_capabilities({ "width": 1440, "height": 900, "coarsePointer": false, "hardwareConcurrency": 12, "deviceMemory": 16 }), 0)
	assert_eq(CharacterPresentation.character_model_tier_for_capabilities({ "width": 844, "height": 390, "coarsePointer": true, "hardwareConcurrency": 8, "deviceMemory": 8, "devicePixelRatio": 2 }), 1)
	assert_eq(CharacterPresentation.character_model_tier_for_capabilities({ "width": 390, "height": 844, "coarsePointer": true, "hardwareConcurrency": 2, "deviceMemory": 2, "devicePixelRatio": 3 }), 2)
	assert_eq(CharacterPresentation.character_model_tier_for_capabilities({ "width": 620, "height": 900, "coarsePointer": false, "hardwareConcurrency": 8, "deviceMemory": 8 }), 1)

func test_maps_both_character_families_to_one_selected_lod_without_changing_full_paths() -> void:
	assert_eq(CharacterPresentation.character_model_path_for_tier("/models/market/characters/owner_man.glb", 0), "/models/market/characters/owner_man.glb")
	assert_eq(CharacterPresentation.character_model_path_for_tier("/models/market/characters/owner_man.glb", 1), "/models/market/characters/lod1/owner_man.glb")
	assert_eq(CharacterPresentation.character_model_path_for_tier("/models/market/customers/customer_01.glb", 2), "/models/market/customers/lod2/customer_01.glb")

func test_preloads_every_customer_identity_before_live_play_for_the_active_tier() -> void:
	assert_eq(CharacterPresentation.priority_customer_model_paths_for_tier(2), [
		"/models/market/customers/lod2/customer_01_man_young.glb",
		"/models/market/customers/lod2/customer_02_man_senior.glb",
		"/models/market/customers/lod2/customer_03_woman_young.glb",
		"/models/market/customers/lod2/customer_04_woman_adult.glb",
		"/models/market/customers/lod2/customer_05_woman_mature.glb",
		"/models/market/customers/lod2/customer_06_woman_senior.glb",
	])
	assert_eq(CharacterPresentation.priority_customer_model_paths_for_tier(0).size(), 6)
	assert_false(JS.some(CharacterPresentation.priority_customer_model_paths_for_tier(0), func(path): return path.contains("/characters/owner_")))

func test_reduces_only_crowd_facial_sampling_on_constrained_presentation_tiers() -> void:
	assert_near(CharacterPresentation.character_face_update_interval(0, false), 1.0 / 24.0, 0.005)
	assert_near(CharacterPresentation.character_face_update_interval(0, true), 1.0 / 16.0, 0.005)
	assert_near(CharacterPresentation.character_face_update_interval(1, true), 1.0 / 12.0, 0.005)
	assert_near(CharacterPresentation.character_face_update_interval(2, true), 1.0 / 8.0, 0.005)

func test_uses_conservative_bounds_to_cull_only_actors_safely_outside_the_camera() -> void:
	var projection := Projection.create_perspective(50, 1, 0.1, 100)
	var camera := Transform3D(Basis.IDENTITY, Vector3(0, 1, 7)).looking_at(Vector3(0, 1, 0), Vector3.UP)
	var actor := Transform3D.IDENTITY
	assert_true(CharacterPresentation.character_is_in_view(projection, camera, actor))
	actor.origin.x = 100
	assert_false(CharacterPresentation.character_is_in_view(projection, camera, actor))
