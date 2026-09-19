extends TestCase

func test_covers_all_four_bodies_at_all_three_detail_levels_with_disjoint_ranges() -> void:
	var masks := AvatarHairMask.masks()
	assert_eq(masks.size(), 12)
	for mask in masks.values():
		var end := 0
		for run in mask.runs:
			var start := int(run[0])
			var count := int(run[1])
			assert_gte(start, end)
			assert_gt(count, 0)
			end = start + count
			assert_lte(end, int(mask.triangles))

func test_never_mutates_the_geometry_used_by_approved_hats_and_reuses_its_cache() -> void:
	var key := "characters/lod2/owner_girl.glb"
	var mask: Dictionary = AvatarHairMask.masks()[key]
	var triangles := int(mask.triangles)
	var vertices := PackedVector3Array()
	vertices.resize(triangles * 3)
	var index := PackedInt32Array()
	for i in triangles * 3: index.append(i)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_INDEX] = index
	var original := ArrayMesh.new()
	original.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var result := AvatarHairMask.masked_hair_geometry(original, "/models/market/%s" % key)
	assert_false(is_same(result, original))
	var original_index: PackedInt32Array = original.surface_get_arrays(0)[Mesh.ARRAY_INDEX]
	assert_eq(original_index, index)
	assert_eq(original_index.size(), triangles * 3)
	var removed := 0
	for run in mask.runs: removed += int(run[1])
	assert_eq((result.surface_get_arrays(0)[Mesh.ARRAY_INDEX] as PackedInt32Array).size(), (triangles - removed) * 3)
	assert_true(is_same(AvatarHairMask.masked_hair_geometry(original, "/models/market/%s" % key), result))

func test_refuses_an_obsolete_mask_when_an_asset_has_different_topology() -> void:
	var geometry := BoxMesh.new()
	assert_true(is_same(AvatarHairMask.masked_hair_geometry(geometry, "/models/market/characters/owner_man.glb"), geometry))
