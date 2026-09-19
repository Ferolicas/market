class_name AvatarHairMask
extends RefCounted
## Port of src/game/animation/AvatarHairMask.ts.
## The authored masks live in res://game/animation/avatar-hair-masks.json
## ({ "<model path>": { "triangles": int, "runs": [[start, count], ...] } }).

const MASKS_PATH := "res://game/animation/avatar-hair-masks.json"

static var _masks: Dictionary = {}
static var _masks_loaded := false
## original mesh instance id → masked ArrayMesh (the WeakMap cache).
static var _cache := {}

static func masks() -> Dictionary:
	if not _masks_loaded:
		_masks_loaded = true
		var file := FileAccess.open(MASKS_PATH, FileAccess.READ)
		if file != null:
			var parsed = JSON.parse_string(file.get_as_text())
			if parsed is Dictionary: _masks = parsed
	return _masks

static func mask_for(model_path: String) -> Variant:
	var key := model_path.replace("/models/market/", "")
	return masks().get(key)

## Index buffer with only the authored hair faces removed, or null when the
## mask is missing or stale (different topology) so the face is never damaged.
static func masked_hair_index(index: PackedInt32Array, model_path: String) -> Variant:
	var mask = mask_for(model_path)
	# Refuse stale masks after an asset replacement instead of damaging its face.
	if mask == null or index.is_empty() or index.size() != int(mask.triangles) * 3: return null
	var triangles := int(mask.triangles)
	var removed := PackedByteArray()
	removed.resize(triangles)
	for run in mask.runs:
		var start := int(run[0])
		var end := mini(triangles, start + int(run[1]))
		for triangle in range(start, end): removed[triangle] = 1
	var kept := PackedInt32Array()
	for triangle in triangles:
		if removed[triangle] == 0:
			for k in 3: kept.append(index[triangle * 3 + k])
	return kept

## Remove only authored hair faces; retain original skin, morphs and UVs.
## Returns the original mesh untouched when the mask does not apply.
static func masked_hair_geometry(original: Mesh, model_path: String, surface: int = 0) -> Mesh:
	if original == null or original.get_surface_count() <= surface: return original
	var arrays := original.surface_get_arrays(surface)
	var index: Variant = arrays[Mesh.ARRAY_INDEX]
	if index == null: return original
	var kept = masked_hair_index(index, model_path)
	if kept == null: return original
	var cache_key := original.get_instance_id()
	if _cache.has(cache_key): return _cache[cache_key]
	var geometry := ArrayMesh.new()
	var masked := arrays.duplicate()
	masked[Mesh.ARRAY_INDEX] = kept
	var blend_shapes: Array = original.surface_get_blend_shape_arrays(surface) if original is ArrayMesh else []
	if original is ArrayMesh:
		for shape in (original as ArrayMesh).get_blend_shape_count():
			geometry.add_blend_shape((original as ArrayMesh).get_blend_shape_name(shape))
	geometry.add_surface_from_arrays(original.surface_get_primitive_type(surface), masked, blend_shapes, {}, original.surface_get_format(surface) if original is ArrayMesh else 0)
	geometry.surface_set_material(0, original.surface_get_material(surface))
	_cache[cache_key] = geometry
	return geometry
