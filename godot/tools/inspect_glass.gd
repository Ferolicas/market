extends SceneTree
func _init() -> void:
	var scene := AuthoredScene.new()
	root.add_child(scene)
	scene.load_part("building")
	for node in scene.nodes.values():
		if not node is MeshInstance3D: continue
		var material := SourcePbr.source_material(node)
		if material is StandardMaterial3D and material.get_meta("three_transmission", 0.0) > 0:
			print(node.name, " color=", material.albedo_color, " rough=", material.roughness, " metal=", material.metallic, " coat=",material.clearcoat, " enabled=",material.clearcoat_enabled, " coatrough=",material.clearcoat_roughness)
	scene.free()
	quit()
