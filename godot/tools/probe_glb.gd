extends SceneTree
# Headless probe: loads converted GLBs and prints what Godot sees.
func _init():
	for p in ["res://assets/models/market/characters/owner_man.glb", "res://assets/models/market/environment/shelf_gondola_single.glb", "res://assets/models/market/delivered/cow.glb"]:
		var scene = load(p)
		if scene == null:
			print("FAIL load ", p); continue
		var inst = scene.instantiate()
		var anim = _find(inst, "AnimationPlayer")
		var meshes = []
		_collect(inst, meshes)
		print(p.get_file(), " meshes=", meshes.size(), " anims=", (anim.get_animation_list().size() if anim else 0), " skel=", _find(inst, "Skeleton3D") != null)
		for m in meshes:
			var mi: MeshInstance3D = m
			print("   ", mi.name, " surfaces=", mi.mesh.get_surface_count(), " aabb=", mi.get_aabb(), " skin=", mi.skin != null)
		inst.free()
	quit()
func _find(n: Node, cls: String):
	if n.get_class() == cls: return n
	for c in n.get_children():
		var r = _find(c, cls)
		if r: return r
	return null
func _collect(n: Node, out: Array):
	if n is MeshInstance3D: out.append(n)
	for c in n.get_children(): _collect(c, out)
