class_name AnimationCacheWarmup
extends RefCounted
## Pre-fills CarrySocket's compose_carry_animation_library() cache for every
## body the very first sync_state() call is about to spawn (6 customer
## identities + the two employee genders, both with and without a hat, since
## that changes the GLB path), spread one per frame under the loading
## curtain. Without this, MarketWorld._ready()'s first sync_state() call
## pays ~90ms per UNSEEN identity synchronously in a single frame — the
## loading-curtain freeze this exists to remove. Real device data: repeat
## spawns of an already-cached identity cost ~16-17ms, first spawns ~90ms.
const EMPLOYEE_BODY_FILES := ["owner_man", "owner_woman"]

static func _paths_to_warm() -> Array:
	# Must match _load_rig()'s own path exactly (identity/body path THEN
	# character_model_path_for_tier()) or the cache key never lines up —
	# tier is rarely 0 on an actual device (it defaults on capabilities, not
	# a fixed value), which silently broke this on the first attempt.
	var tier := CharacterPresentation.character_model_tier_for_capabilities(CharacterPresentation.current_character_capabilities())
	var paths: Array = []
	for source_path in CharacterPresentation.PRIORITY_CUSTOMER_MODEL_PATHS:
		paths.append(CharacterPresentation.character_model_path_for_tier("res://assets" + source_path, tier))
	for body_file in EMPLOYEE_BODY_FILES:
		paths.append(CharacterPresentation.character_model_path_for_tier("res://assets/models/market/characters/%s.glb" % body_file, tier))
		paths.append(CharacterPresentation.character_model_path_for_tier("res://assets/models/market/characters/%s_bald.glb" % body_file, tier))
	return paths

## tree: any Node currently inside the SceneTree, used only to await frames.
static func warm(tree: SceneTree) -> void:
	for path in _paths_to_warm():
		if not ResourceLoader.exists(path): continue
		var source: Node3D = load(path).instantiate()
		var players := source.find_children("*", "AnimationPlayer", true, false)
		if not players.is_empty():
			var player: AnimationPlayer = players[0]
			for library_name in player.get_animation_library_list():
				CarrySocket.compose_carry_animation_library(player.get_animation_library(library_name), "%s:%s" % [path, library_name])
		source.free()
		await tree.process_frame
