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

## Backs the *_glbLoadMs/*_instantiateMs/*_indexMs/*_entriesLoopMs fields
## folded into startup-world-load telemetry (market_world.gd), used to find
## why crops_bind_ms (~6s) was over 2x furniture_ms despite a smaller .glb and
## fewer manifest entries.
func test_load_part_records_a_phase_breakdown_for_telemetry() -> void:
	Authored.take_load_phase_stats() # drain leftovers from the test above
	var scene := Authored.new()
	scene.load_part("ground")
	var stats := Authored.take_load_phase_stats()
	for suffix in ["_glbLoadMs", "_instantiateMs", "_indexMs", "_entriesLoopMs"]:
		var key: String = "ground" + suffix
		assert_true(stats.has(key), key)
		assert_gte(stats[key], 0)
	assert_eq(Authored.take_load_phase_stats(), {}, "Stats drain on read")
	scene.free()

## _index() used to call surface_get_arrays() (decodes the whole vertex
## buffer) on every surface just to check for a color channel; it now reads
## surface_get_format()'s flag instead. Must produce the identical outcome:
## vertex_color_use_as_albedo enabled only on surfaces that actually carry
## per-vertex color.
func test_index_still_enables_vertex_color_only_on_surfaces_that_carry_it() -> void:
	var scene := Authored.new()
	var colored := MeshInstance3D.new()
	colored.name = "Colored"
	var colored_mesh := ArrayMesh.new()
	var colored_arrays := []
	colored_arrays.resize(Mesh.ARRAY_MAX)
	colored_arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3.ZERO, Vector3.RIGHT, Vector3.UP])
	colored_arrays[Mesh.ARRAY_COLOR] = PackedColorArray([Color.RED, Color.GREEN, Color.BLUE])
	colored_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, colored_arrays)
	colored_mesh.surface_set_material(0, StandardMaterial3D.new())
	colored.mesh = colored_mesh
	var plain := MeshInstance3D.new()
	plain.name = "Plain"
	var plain_mesh := ArrayMesh.new()
	var plain_arrays := []
	plain_arrays.resize(Mesh.ARRAY_MAX)
	plain_arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3.ZERO, Vector3.RIGHT, Vector3.UP])
	plain_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, plain_arrays)
	plain_mesh.surface_set_material(0, StandardMaterial3D.new())
	plain.mesh = plain_mesh
	var root := Node3D.new()
	root.add_child(colored)
	root.add_child(plain)
	scene._index(root)
	assert_true((colored.get_surface_override_material(0) as StandardMaterial3D).vertex_color_use_as_albedo)
	assert_null(plain.get_surface_override_material(0), "A surface with no color channel must not get an override material at all")
	root.free()
	scene.free()
