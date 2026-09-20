extends TestCase
func test_original_hair_masks_are_baked_before_import_and_keep_rigs() -> void:
	var report: Array = JSON.parse_string(FileAccess.get_file_as_string("res://assets/models/market/hair-mask-report.json"))
	assert_eq(report.size(), 12)
	for entry in report:
		var source: Node3D = (load(str(entry.output).replace("godot/", "res://")) as PackedScene).instantiate()
		var triangles := 0
		for mesh in source.find_children("*", "MeshInstance3D", true, false):
			for surface in mesh.mesh.get_surface_count():
				triangles += mesh.mesh.surface_get_arrays(surface)[Mesh.ARRAY_INDEX].size() / 3
		assert_eq(triangles, entry.retainedTriangles, entry.source)
		assert_gt(source.find_children("*", "Skeleton3D", true, false).size(), 0)
		var players := source.find_children("*", "AnimationPlayer", true, false)
		assert_eq(players.size(), 1)
		assert_gt(players[0].get_animation_list().size(), 10)
		source.free()
