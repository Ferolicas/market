extends SceneTree
func _init() -> void:
	var content := AuthoredScene.new()
	root.add_child(content)
	content.load_part("ground")
	for node in content.nodes.values():
		if node is MeshInstance3D:
			var material: StandardMaterial3D = node.get_active_material(0)
			if material.vertex_color_use_as_albedo:
				print("VERTEX ", node.mesh.surface_get_arrays(0)[Mesh.ARRAY_COLOR][0], " SRGB ", material.vertex_color_is_srgb)
				print(node.name, " albedo=", material.albedo_color, " emission=", material.emission, " energy=", material.emission_energy_multiplier, " shading=", material.shading_mode, " transparency=", material.transparency, " refraction=", material.refraction_enabled, " scale=", material.refraction_scale, " depth=", material.depth_draw_mode)
	content.free()
	quit()
