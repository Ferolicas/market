extends SceneTree
func _initialize() -> void:
	_run.call_deferred()
func _run() -> void:
	var scope := Node3D.new()
	root.add_child(scope)
	var mesh := MeshInstance3D.new()
	mesh.mesh = BoxMesh.new()
	mesh.material_override = StandardMaterial3D.new()
	scope.add_child(mesh)
	var adapter := SourcePbr.new()
	adapter.scope = scope
	scope.add_child(adapter)
	assert(mesh.get_active_material(0) is ShaderMaterial)
	var original: StandardMaterial3D = SourcePbr.source_material(mesh)
	original.albedo_color = Color.RED
	SourcePbr.touch(original)
	assert(mesh.get_active_material(0).get_shader_parameter("base_color") == Color.RED)
	await process_frame
	scope.free()
	quit()
