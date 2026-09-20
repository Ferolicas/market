class_name CharacterPresentation
extends RefCounted
## Port of src/game/animation/CharacterPresentation.ts.
##
## Pure decisions (tiers, LOD paths, face cadence, sole profiles, material
## finish, texture filtering, sole placement, frustum test) are static funcs
## on plain values. Node/material building (`prepare_character_model`,
## `attach_closed_soles`, `apply_premium_material`, `build_sole_mesh`) targets
## Godot equivalents: StandardMaterial3D, BoxMesh, MeshInstance3D and
## BoneAttachment3D. Three's MeshStandard/MeshPhysical split does not exist in
## Godot, so every StandardMaterial3D receives the "physical" finish.
## build: "adult" | "child". tier: 0 | 1 | 2.

const CHARACTER_CULL_RADIUS := 2.45
const CHARACTER_FACE_UPDATE_INTERVAL := 1.0 / 24.0
const PRIORITY_CUSTOMER_MODEL_PATHS := [
	"/models/market/customers/customer_01_man_young.glb",
	"/models/market/customers/customer_02_man_senior.glb",
	"/models/market/customers/customer_03_woman_young.glb",
	"/models/market/customers/customer_04_woman_adult.glb",
	"/models/market/customers/customer_05_woman_mature.glb",
	"/models/market/customers/customer_06_woman_senior.glb",
]

## The reconstructed GLBs already contain the visible shoe upper. This shared
## insert only seals the underside, so it must stay inside that silhouette.
## In particular it is centred on the Foot bone: offsetting it towards the toe
## turns the insert into a detached, flipper-like slab during a step.
const CHARACTER_SOLE_PROFILES := {
	"adult": { "width": 0.154, "thickness": 0.024, "length": 0.242, "centerZ": 0.0, "bevel": 0.011 },
	"child": { "width": 0.12, "thickness": 0.02, "length": 0.188, "centerZ": 0.0, "bevel": 0.009 },
}

const SOLE_MATERIAL_NAME := "RuntimePremiumSole"
const SOLE_COLOR := "#1d211f"
const SOLE_ROUGHNESS := 0.82
const SOLE_METALNESS := 0.0
const SOLE_ENV_MAP_INTENSITY := 0.42
const SHARED_RESOURCE_META := "characterSharedResource"
const SOLE_BUILD_META := "characterSoleBuild"

static var _scheduled_character_preloads := {}
static var _sole_geometries := {}
static var _sole_material: StandardMaterial3D = null
static var _prepared_character_maps := {}

## Pure policy shared by device selection and unit tests. A coarse pointer is
## the strongest phone/tablet signal; CPU/RAM and the live viewport cover
## low-end laptops, split-screen and orientation changes.
## capabilities: { width, height, coarsePointer, hardwareConcurrency?, deviceMemory?, devicePixelRatio? }
static func character_model_tier_for_capabilities(capabilities: Dictionary) -> int:
	var short_edge: float = minf(capabilities.width, capabilities.height)
	var cores: float = JS.get_or(capabilities, "hardwareConcurrency", 8)
	var memory: float = JS.get_or(capabilities, "deviceMemory", 8)
	var pixel_ratio: float = JS.get_or(capabilities, "devicePixelRatio", 1)
	var coarse: bool = capabilities.coarsePointer
	if cores <= 2 or memory <= 2 or (coarse and short_edge <= 430 and pixel_ratio >= 3 and cores <= 4): return 2
	if coarse or cores <= 4 or memory <= 4 or short_edge <= 700: return 1
	return 0

## Live device capabilities from the Godot runtime (the browser store equivalent).
static func current_character_capabilities() -> Dictionary:
	if OS.has_feature("web"):
		return JSON.parse_string(str(JavaScriptBridge.eval("JSON.stringify({width:innerWidth,height:innerHeight,coarsePointer:matchMedia('(pointer: coarse)').matches,hardwareConcurrency:navigator.hardwareConcurrency??8,deviceMemory:navigator.deviceMemory??8,devicePixelRatio:devicePixelRatio})", true)))
	var size := DisplayServer.window_get_size()
	return {
		"width": size.x,
		"height": size.y,
		"coarsePointer": DisplayServer.is_touchscreen_available(),
		"hardwareConcurrency": OS.get_processor_count(),
		"deviceMemory": float(OS.get_memory_info().get("physical", 8 * 1024 * 1024 * 1024)) / float(1024 * 1024 * 1024),
		"devicePixelRatio": DisplayServer.screen_get_scale(),
	}

static func character_model_path_for_tier(path: String, tier: int) -> String:
	if tier == 0: return path
	var family := "/customers/" if path.contains("/customers/") else "/characters/"
	return path.replace(family, "%slod%d/" % [family, tier])

## Facial morphs are secondary motion in a crowd. Locomotion and interaction
## clips still run every presented frame; only expression weights are sampled
## less often as device pressure increases.
static func character_face_update_interval(tier: int, crowd: bool) -> float:
	if not crowd: return CHARACTER_FACE_UPDATE_INTERVAL
	return 1.0 / 8.0 if tier == 2 else (1.0 / 12.0 if tier == 1 else 1.0 / 16.0)

## Warm the complete six-body customer cast behind the readiness cover. This
## keeps an identity first seen in a later wave from decoding GLB data and
## compiling a skinning program in the middle of player movement.
static func priority_customer_model_paths_for_tier(tier: int) -> Array:
	return JS.map(PRIORITY_CUSTOMER_MODEL_PATHS, func(path): return character_model_path_for_tier(path, tier))

## Paths not yet scheduled, deduplicated and marked as scheduled (global set).
static func take_unscheduled_preloads(paths: Array) -> Array:
	var queue := []
	for path in paths:
		if _scheduled_character_preloads.has(path) or queue.has(path): continue
		_scheduled_character_preloads[path] = true
		queue.append(path)
	return queue

## Starts each decoder during a separate idle slice (420 ms apart) so ten
## concurrent GLB decodes never become one long main-thread stall.
static func schedule_character_model_preload(paths: Array, preload_callable: Callable) -> void:
	_run_preload_queue(take_unscheduled_preloads(paths), 0, preload_callable)

static func _run_preload_queue(queue: Array, index: int, preload_callable: Callable) -> void:
	if index >= queue.size(): return
	preload_callable.call(queue[index])
	var loop := Engine.get_main_loop()
	if loop is SceneTree:
		(loop as SceneTree).create_timer(0.42).timeout.connect(func(): _run_preload_queue(queue, index + 1, preload_callable))
	else:
		_run_preload_queue(queue, index + 1, preload_callable)

## Tests one conservative actor-sized sphere against the camera frustum built
## from `projection × inverse(camera_world)` (Three's Frustum.setFromProjectionMatrix).
## Render meshes keep native frustum culling too; this probe additionally lets
## frame callbacks skip facial, carry and IK work while the actor is off camera.
static func character_is_in_view(projection: Projection, camera_world: Transform3D, actor_world: Transform3D) -> bool:
	var scale := actor_world.basis.get_scale()
	var radius := CHARACTER_CULL_RADIUS * maxf(absf(scale.x), maxf(absf(scale.y), absf(scale.z)))
	var center := actor_world.origin
	var m := projection * Projection(camera_world.affine_inverse())
	var rows := [
		Vector4(m.x.x, m.y.x, m.z.x, m.w.x),
		Vector4(m.x.y, m.y.y, m.z.y, m.w.y),
		Vector4(m.x.z, m.y.z, m.z.z, m.w.z),
		Vector4(m.x.w, m.y.w, m.z.w, m.w.w),
	]
	var planes := [rows[3] + rows[0], rows[3] - rows[0], rows[3] + rows[1], rows[3] - rows[1], rows[3] + rows[2], rows[3] - rows[2]]
	for plane in planes:
		var normal := Vector3(plane.x, plane.y, plane.z)
		var length := normal.length()
		if length <= 0.0: continue
		var distance: float = (normal.dot(center) + plane.w) / length
		if distance < -radius: return false
	return true

## Node adapter of character_is_in_view.
static func character_node_is_in_view(camera: Camera3D, actor: Node3D) -> bool:
	return character_is_in_view(camera.get_camera_projection(), CarrySocket.world_transform_of(camera), CarrySocket.world_transform_of(actor))

## Material finish decision. name: material name; physical: has clearcoat/sheen
## channels; has_map: has an albedo texture. Returns the values to apply.
static func premium_material_finish(name: String, roughness: float, physical: bool, has_map: bool, crowd: bool) -> Dictionary:
	var lower := name.to_lower()
	var facial_overlay := lower.contains("eyelid") or lower.contains("eyelash") or lower.contains("mouthinterior") or lower.contains("teeth") or lower.contains("tongue")
	# The reconstructed body shell and outsole are closed. Only the paper-thin
	# eyelash cards genuinely need two-sided rendering.
	var finish := {
		"side": "double" if lower.contains("eyelash") else "front",
		"metalness": 0.0,
		"roughness": clampf(roughness, 0.5, 0.82) if facial_overlay else clampf(roughness * 0.72, 0.54, 0.68),
		"envMapIntensity": 0.68 if crowd else 0.82,
		"emissive": false,
	}
	# The atlas contains intentionally soft studio shading. A restrained fill
	# retains facial readability in the deep supermarket shadows while still
	# responding to the scene lights and contact shadows.
	if has_map and not facial_overlay:
		finish.emissive = true
		finish["emissiveColor"] = "#ffffff"
		finish["emissiveIntensity"] = 0.075 if crowd else 0.055
	if physical and not facial_overlay:
		finish["clearcoat"] = 0.1
		finish["clearcoatRoughness"] = 0.62
		finish["sheen"] = 0.08
		finish["sheenColor"] = "#fff4e9"
		finish["sheenRoughness"] = 0.82
		finish["specularIntensity"] = 0.34
	return finish

## Texture sampling decision for a shared character map.
static func character_map_filter(compressed: bool, mipmap_count: int, anisotropy: int = 1) -> Dictionary:
	var can_generate_mipmaps := not compressed
	return {
		"anisotropy": maxi(8, anisotropy),
		"magFilter": "linear",
		"generateMipmaps": can_generate_mipmaps,
		"minFilter": "linear-mipmap-linear" if (can_generate_mipmaps or mipmap_count > 1) else "linear",
	}

## Bone-local Y of the sole centre solved from the actual rest-pose ground.
## This keeps every adult, senior and child outsole flush even though their
## ankle heights differ by more than four centimetres.
static func sole_center_y(build: String, ground_y: float, foot_origin_y: float, local_y_axis: Vector3, local_z_axis: Vector3) -> float:
	var profile: Dictionary = CHARACTER_SOLE_PROFILES[build]
	var target_center_y: float = ground_y + profile.thickness * 0.5 + 0.0015
	if absf(local_y_axis.y) > 0.4:
		return (target_center_y - foot_origin_y - profile.centerZ * local_z_axis.y) / local_y_axis.y
	return 0.063 if build == "child" else 0.096

# --- Godot node / material builders ------------------------------------------

## Shared sole geometry per build (BoxMesh; the rounded bevel of
## RoundedBoxGeometry has no primitive equivalent and is recorded in the profile).
static func sole_geometry(build: String) -> BoxMesh:
	if not _sole_geometries.has(build):
		var profile: Dictionary = CHARACTER_SOLE_PROFILES[build]
		var mesh := BoxMesh.new()
		mesh.size = Vector3(profile.width, profile.thickness, profile.length)
		mesh.set_meta(SHARED_RESOURCE_META, true)
		_sole_geometries[build] = mesh
	return _sole_geometries[build]

static func sole_material() -> StandardMaterial3D:
	if _sole_material == null:
		var material := StandardMaterial3D.new()
		material.resource_name = SOLE_MATERIAL_NAME
		material.albedo_color = Color(SOLE_COLOR)
		material.roughness = SOLE_ROUGHNESS
		material.metallic = SOLE_METALNESS
		material.set_meta(SHARED_RESOURCE_META, true)
		_sole_material = material
	return _sole_material

## Creates an instance-local material set while keeping the heavy geometry and
## textures shared by the GLB import. The final material pass is deliberately
## subtle: it removes the dry scan look without turning cloth or skin into
## chrome. The closed body shell uses normal back-face culling, while only
## genuinely paper-thin facial cards opt into two-sided rendering.
## options: { build?, crowd?, reducedDetail?, repairOpenSoles? }
static func prepare_character_model(source: Node3D, options: Dictionary = {}) -> Node3D:
	var model: Node3D = source.duplicate()
	var crowd: bool = JS.get_or(options, "crowd", false)
	var reduced_detail: bool = JS.get_or(options, "reducedDetail", false)
	for mesh in _mesh_instances(model):
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if (crowd or reduced_detail) else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		apply_conservative_character_bounds(mesh)
		if mesh.mesh == null: continue
		for surface in mesh.mesh.get_surface_count():
			var material: Material = mesh.get_active_material(surface)
			if material is StandardMaterial3D:
				mesh.set_surface_override_material(surface, premium_material(material, crowd))
	if JS.get_or(options, "repairOpenSoles", false): attach_closed_soles(model, JS.get_or(options, "build", "adult"), crowd)
	return model

## Dispose only the instance-local materials; GLB geometry/textures and the
## shared sole resources remain owned by their caches. Returns the count released.
static func dispose_character_materials(model: Node3D) -> int:
	var released := {}
	for mesh in _mesh_instances(model):
		for surface in mesh.get_surface_override_material_count():
			var material: Material = mesh.get_surface_override_material(surface)
			if material == null or material.get_meta(SHARED_RESOURCE_META, false): continue
			released[material.get_instance_id()] = true
			mesh.set_surface_override_material(surface, null)
	return released.size()

static func premium_material(source: StandardMaterial3D, crowd: bool) -> StandardMaterial3D:
	var material: StandardMaterial3D = source.duplicate()
	prepare_shared_character_maps(material)
	apply_premium_material(material, crowd)
	return material

## Applies premium_material_finish to a StandardMaterial3D in place.
static func apply_premium_material(material: StandardMaterial3D, crowd: bool) -> void:
	var finish := premium_material_finish(material.resource_name, material.roughness, true, material.albedo_texture != null, crowd)
	material.cull_mode = BaseMaterial3D.CULL_DISABLED if finish.side == "double" else BaseMaterial3D.CULL_BACK
	material.metallic = finish.metalness
	material.roughness = finish.roughness
	if finish.emissive:
		material.emission_enabled = true
		material.emission = Color(finish.emissiveColor)
		material.emission_texture = material.albedo_texture
		material.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY
		material.emission_energy_multiplier = finish.emissiveIntensity
	if finish.has("clearcoat"):
		material.clearcoat_enabled = true
		material.clearcoat = finish.clearcoat
		material.clearcoat_roughness = finish.clearcoatRoughness
		material.metallic_specular = finish.specularIntensity
		material.set_meta("three_specular_intensity", finish.specularIntensity)
		material.set_meta("three_sheen", finish.sheen)
		material.set_meta("three_sheen_color", finish.sheenColor)
		material.set_meta("three_sheen_roughness", finish.sheenRoughness)

## Godot samples textures per material: the shared map keeps its data and the
## material asks for anisotropic mipmapped filtering once.
static func prepare_shared_character_maps(material: StandardMaterial3D) -> void:
	var texture := material.albedo_texture
	if texture == null: return
	var key := texture.get_instance_id()
	var compressed := texture is CompressedTexture2D
	var filter := character_map_filter(compressed, 1)
	material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC if filter.minFilter == "linear-mipmap-linear" else BaseMaterial3D.TEXTURE_FILTER_LINEAR
	_prepared_character_maps[key] = filter

static func apply_conservative_character_bounds(mesh: MeshInstance3D) -> void:
	var radius := CHARACTER_CULL_RADIUS
	mesh.custom_aabb = AABB(Vector3(-radius, -radius, -radius), Vector3(radius * 2, radius * 2, radius * 2))

## Legacy repair path for third-party GLBs whose shoe bottom is open. The
## current market cast already contains a rigged outsole baked by Blender.
static func attach_closed_soles(model: Node3D, build: String, crowd: bool) -> void:
	var profile: Dictionary = CHARACTER_SOLE_PROFILES[build]
	var geometry := sole_geometry(build)
	var ground_y := model_ground_y(model)
	for side in ["L", "R"]:
		var foot := _foot_node(model, side)
		if foot == null or foot.find_child("PremiumSole_%s" % side, true, false) != null: continue
		var foot_world := CarrySocket.world_transform_of(foot)
		var local_y_axis := (foot_world.basis * Vector3(0, 1, 0)).normalized()
		var local_z_axis := (foot_world.basis * Vector3(0, 0, 1)).normalized()
		var center_y := sole_center_y(build, ground_y, foot_world.origin.y, local_y_axis, local_z_axis)
		var sole := MeshInstance3D.new()
		sole.name = "PremiumSole_%s" % side
		sole.mesh = geometry
		sole.material_override = sole_material()
		sole.position = Vector3(0, center_y, profile.centerZ)
		sole.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if crowd else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		sole.set_meta(SHARED_RESOURCE_META, true)
		sole.set_meta(SOLE_BUILD_META, build)
		foot.add_child(sole)

## Lowest world Y of every mesh under the model (Box3.setFromObject().min.y).
static func model_ground_y(model: Node3D) -> float:
	var ground := INF
	for mesh in _mesh_instances(model):
		if mesh.mesh == null: continue
		var world := CarrySocket.world_transform_of(mesh)
		var aabb: AABB = mesh.mesh.get_aabb()
		for corner in 8:
			ground = minf(ground, (world * aabb.get_endpoint(corner)).y)
	return 0.0 if ground == INF else ground

## A Node3D named Foot_<side>, or a BoneAttachment3D created for that bone on the model's Skeleton3D.
static func _foot_node(model: Node3D, side: String) -> Node3D:
	var name := "Foot_%s" % side
	var existing := model.find_child(name, true, false)
	if existing is Node3D: return existing
	for skeleton in _find_all(model, "Skeleton3D"):
		var bone := (skeleton as Skeleton3D).find_bone(name)
		if bone < 0: continue
		var attachment := BoneAttachment3D.new()
		attachment.name = name
		attachment.bone_name = name
		skeleton.add_child(attachment)
		return attachment
	return null

static func _mesh_instances(root: Node) -> Array:
	return _find_all(root, "MeshInstance3D")

static func _find_all(root: Node, type_name: String, out: Array = []) -> Array:
	if root.is_class(type_name): out.append(root)
	for child in root.get_children(): _find_all(child, type_name, out)
	return out
