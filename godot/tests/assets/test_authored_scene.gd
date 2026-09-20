extends TestCase
const Authored = preload("res://game/scene/authored_scene.gd")

func test_source_scene_geometry_labels_and_external_rigs_load() -> void:
	for part in ["ground", "city", "building", "furniture", "farm", "closed-checkouts"]:
		var scene := Authored.new()
		scene.load_part(part)
		assert_gt(scene.nodes.size(), 1, part)
		assert_eq(scene.labels.size(), scene.manifest.labels.size(), part)
		assert_gt(scene.find_children("*", "MeshInstance3D", true, false).size(), 0, part)
		for entry in scene.manifest.manifest:
			assert_true(scene.nodes.has(entry.name), part + ": missing authored node " + entry.name)
		for animal in scene.animals:
			for clip in ["Idle", "Walk", "Graze" if animal.kind == "cow" else "Peck"]:
				assert_true(Array(animal.player.get_animation_list()).any(func(name): return name == clip or name.ends_with("/" + clip)), "Missing " + clip)
		scene.free()
