class_name CarrySocket
extends RefCounted
## Port of src/game/animation/CarrySocket.ts.
##
## Pure decisions work on Transform3D/Vector3 and on a Dictionary clip model:
##   clip  = { "name": String, "duration": float, "tracks": Array[track] }
##   track = { "name": "Bone.position" | "Bone.quaternion" | "Bone.scale" | "Bone.rotation[x]",
##             "times": PackedFloat32Array, "values": PackedFloat32Array,
##             "type": "vector" | "quaternion" | "number", "path": String (Godot track path, optional) }
## `clip_from_animation` / `animation_from_clip` convert Godot Animation
## resources (GLB imports) to and from that model; `compose_carry_animation_library`
## applies the composition to an AnimationLibrary once per library instance.
## Node3D adapters (`apply_*`, `mounted_harvest_basket_handle`) are the only
## scene-facing functions and compute world transforms by walking parents, so
## they work whether or not the nodes are inside a SceneTree.

const HARVEST_BASKET_GRIP_HEIGHT := 0.18
const HARVEST_BASKET_GRIP_REACH := 0.24
const HARVEST_BASKET_GRIP_HALF_WIDTH := 0.25

## Where a carried bar rests in each hand, in the Hand bone's local frame.
## Measured on the delivered Mixamo cast in the bind pose: vertices weighted to
## the Hand bone (the palm) span local Y 0–0.03 with the fingers continuing to
## Y ≈ 0.10, so the bar sits just past the palm centre towards the finger
## bases. The previous offsets (≈0.28 along −X) were calibrated on an older
## reconstruction and put the bar a forearm's length beyond the wrists.
const CHARACTER_PALM_OFFSETS := {
	"adult-man": { "left": [0.005, 0.04, 0.005], "right": [-0.004, 0.04, 0.007] },
	"adult-woman": { "left": [0.003, 0.038, 0.002], "right": [0.007, 0.036, 0.001] },
	"boy": { "left": [0.001, 0.06, 0.001], "right": [-0.001, 0.06, 0.001] },
	"girl": { "left": [0.003, 0.042, 0.003], "right": [0.008, 0.042, 0.006] },
}

const CARRY_LOCOMOTION_CLIPS := ["CarryIdle", "CarryWalk"]
## The clavicles belong to the frozen pose too: the walk cycle sways them,
## which moved both palms up to 5 cm per step and rocked the carried basket.
const CARRY_ARM_BONES := ["Clavicle_L", "Rig_Arm_L", "Forearm_L", "Hand_L", "Clavicle_R", "Rig_Arm_R", "Forearm_R", "Hand_R"]

const CYLINDER_UP := Vector3(0, 1, 0)
const BASKET_HANDLE_ATTACHMENT_HALF_WIDTH := 0.27
const BASKET_HANDLE_ATTACHMENT_HEIGHT := 0.13
const BASKET_HANDLE_ATTACHMENT_REACH := 0.13

## The bar never shrinks below this half-length: hands closer together than
## that simply hold it nearer its middle instead of at its ends.
const HARVEST_BASKET_BAR_MIN_HALF_LENGTH := 0.22

## Two-handed hold sampled for every carry clip. Measured on the delivered
## cast (grip points at Hand +0.04): CheckoutBag around 13.8 s holds both
## hands 0.22 in front of the chest, level within 0.01 and 0.17–0.23 apart on
## all four bodies, while CarryBox keeps one hand 0.12 higher than the other.
## CarryBox stays as the fallback for packs without the checkout clip.
const CARRY_POSE_SOURCES := [
	{ "clip": "CheckoutBag", "time": 13.8 },
	{ "clip": "CarryBox", "time": 0.5 },
]

const RUNTIME_ANIMATION_ALIASES := {
	"TurnLeft": "Walk",
	"TurnRight": "Walk",
	"Phone": "Wait",
}

const CHECKOUT_CLIPS := ["CheckoutItem", "Pay", "CheckoutScan", "CheckoutBag", "ScanItem"]
const LOWER_BODY_PATTERN := "^(Hips|Rig_Leg_[LR]|Shin_[LR]|Foot_[LR]|Toe_[LR])\\."

## The authored hand mesh starts at the wrist bone and its visible palm lies
## along the bone's local +Y axis. The bone origin therefore measures the
## wrist, not the place where a handle should touch the hand.
static func hand_palm_point(hand_world: Transform3D, palm_offset: Array) -> Vector3:
	return hand_world * Vector3(palm_offset[0], palm_offset[1], palm_offset[2])

## World transform of a Node3D obtained by walking its parents, valid outside a SceneTree.
static func world_transform_of(node: Node3D) -> Transform3D:
	var transform := node.transform
	var parent := node.get_parent()
	while parent != null:
		if parent is Node3D: transform = (parent as Node3D).transform * transform
		parent = parent.get_parent()
	return transform

## Node adapter of hand_palm_point.
static func hand_palm_point_of(hand: Node3D, palm_offset: Array) -> Vector3:
	return hand_palm_point(world_transform_of(hand), palm_offset)

## Resolves only a handle that is currently mounted below this socket. A
## previously detached basket keeps its own internal parent links, so checking
## the cached handle's `parent` cannot distinguish it from the new instance.
static func mounted_harvest_basket_handle(socket: Node) -> Node:
	return socket.find_child("HarvestBasketAdaptiveHandle", true, false)

## Articulates only the handle around a rigid basket body. Its rear bar follows
## the palm span, while two diagonal stays remain visibly connected to the
## basket rim instead of stretching the container itself.
## Returns part name → { position, quaternion?, scale? } in the handle's local frame.
static func update_harvest_basket_handle(handle_scale: float) -> Dictionary:
	var half_width := HARVEST_BASKET_GRIP_HALF_WIDTH * handle_scale
	var bar_half := maxf(half_width, HARVEST_BASKET_BAR_MIN_HALF_LENGTH)
	var left_grip := Vector3(-half_width, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH)
	var right_grip := Vector3(half_width, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH)
	return {
		"BasketGripLeft": { "position": left_grip },
		"BasketGripRight": { "position": right_grip },
		"BasketGripBar": place_cylinder(
			Vector3(-bar_half, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH),
			Vector3(bar_half, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH)),
		"BasketHandleStayLeft": place_cylinder(
			Vector3(-BASKET_HANDLE_ATTACHMENT_HALF_WIDTH, BASKET_HANDLE_ATTACHMENT_HEIGHT, -BASKET_HANDLE_ATTACHMENT_REACH),
			Vector3(-bar_half, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH)),
		"BasketHandleStayRight": place_cylinder(
			Vector3(BASKET_HANDLE_ATTACHMENT_HALF_WIDTH, BASKET_HANDLE_ATTACHMENT_HEIGHT, -BASKET_HANDLE_ATTACHMENT_REACH),
			Vector3(bar_half, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH)),
	}

## Node adapter: applies update_harvest_basket_handle to the named children of `handle`.
static func apply_harvest_basket_handle(handle: Node3D, handle_scale: float) -> void:
	var placements := update_harvest_basket_handle(handle_scale)
	for part_name in placements:
		var part := handle.find_child(part_name, true, false)
		if part == null or not (part is Node3D): continue
		apply_placement(part as Node3D, placements[part_name])

## Sets position / quaternion / scale from a placement Dictionary.
static func apply_placement(node: Node3D, placement: Dictionary) -> void:
	if placement.has("position"): node.position = placement.position
	if placement.has("quaternion"): node.quaternion = placement.quaternion
	if placement.has("scale"): node.scale = placement.scale

## Unit-height cylinder along local +Y stretched between two points.
static func place_cylinder(start: Vector3, end: Vector3) -> Dictionary:
	var direction := end - start
	var length := direction.length()
	var placement := { "position": (start + end) * 0.5 }
	if length > 1e-5:
		placement["quaternion"] = Quaternion(CYLINDER_UP, direction / length)
	placement["scale"] = Vector3(1, maxf(1e-5, length), 1)
	return placement

## Builds carry locomotion with the real leg motion from CarryIdle/CarryWalk
## and a stable two-handed upper-body pose sampled from the first available
## CARRY_POSE_SOURCES clip. The source GLB leaves both carry locomotion hands
## at the hips, so attaching an object to those bones alone still looks like
## a floating prop.
static func compose_carry_animations(animations: Array) -> Array:
	var runtime_animations := compose_runtime_animation_aliases(animations)
	var source: Dictionary = {}
	for candidate in CARRY_POSE_SOURCES:
		var clip = _find_clip(runtime_animations, candidate.clip)
		if clip != null:
			source = { "clip": clip, "time": candidate.time }
			break
	if source.is_empty(): return runtime_animations
	var pose_time: float = minf(source.time, source.clip.duration)
	var arm_pose_tracks := JS.filter(source.clip.tracks, _is_carry_arm_track)
	var composed := []
	for clip in runtime_animations:
		if not CARRY_LOCOMOTION_CLIPS.has(clip.name):
			composed.append(clip)
			continue
		composed.append(_with_pose(clip, clip.name, clip.duration, arm_pose_tracks, pose_time))
	var run = _find_clip(runtime_animations, "Run")
	if run != null and _find_clip(runtime_animations, "CarryRun") == null:
		composed.append(_with_pose(run, "CarryRun", run.duration, arm_pose_tracks, pose_time))
	return composed

static func _with_pose(clip: Dictionary, name: String, duration: float, arm_pose_tracks: Array, pose_time: float) -> Dictionary:
	var tracks := JS.filter(clip.tracks, func(track): return not _is_carry_arm_track(track))
	for track in arm_pose_tracks: tracks.append(_constant_track_at(track, pose_time, duration))
	var out := { "name": name, "duration": duration, "tracks": tracks }
	if clip.has("blendMode"): out["blendMode"] = clip.blendMode
	return out

## Keeps the gameplay state machine compatible with the approved delivered
## cast. The source pack has no dedicated stationary turns or phone gesture,
## so those states reuse an existing delivered performance instead of falling
## back to an unanimated pose.
static func compose_runtime_animation_aliases(animations: Array) -> Array:
	# Checkout gestures share GESTODECAJA's full-body performance. Keep the
	# delivered arms/torso, but anchor its lower body in this rig's standing Idle.
	# Never alter source GLBs or locomotion/harvesting pelvis tracks.
	var standing = _find_clip(animations, "Idle")
	var standing_tracks: Array = JS.filter(standing.tracks, _is_lower_body) if standing != null else []
	var composed := []
	for clip in animations:
		if CHECKOUT_CLIPS.has(clip.name) and not standing_tracks.is_empty():
			var tracks := JS.filter(clip.tracks, func(track): return not _is_lower_body(track))
			for track in standing_tracks: tracks.append(_constant_track_at(track, 0.0, clip.duration))
			var out := { "name": clip.name, "duration": clip.duration, "tracks": tracks }
			if clip.has("blendMode"): out["blendMode"] = clip.blendMode
			composed.append(out)
		else:
			composed.append(clip)
	var names := {}
	for clip in composed: names[clip.name] = true
	for alias in RUNTIME_ANIMATION_ALIASES:
		if names.has(alias): continue
		var source = _find_clip(composed, RUNTIME_ANIMATION_ALIASES[alias])
		if source == null: continue
		var clone: Dictionary = JS.clone(source)
		clone.name = alias
		composed.append(clone)
		names[alias] = true
	return composed

static func _find_clip(clips: Array, name: String) -> Variant:
	return JS.find(clips, func(clip): return clip.name == name)

static func _is_lower_body(track: Dictionary) -> bool:
	var regex := RegEx.create_from_string(LOWER_BODY_PATTERN)
	return regex.search(track.name) != null

static func _is_carry_arm_track(track: Dictionary) -> bool:
	var name: String = track.name
	var target := name.substr(0, JS.last_index_of(name, "."))
	return CARRY_ARM_BONES.has(target)

static func _constant_track_at(track: Dictionary, time: float, duration: float) -> Dictionary:
	var sampled := sample_track(track, time)
	var clone: Dictionary = track.duplicate()
	clone.times = PackedFloat32Array([0.0, duration])
	var values := PackedFloat32Array()
	values.append_array(sampled)
	values.append_array(sampled)
	clone.values = values
	return clone

static func track_value_size(track: Dictionary) -> int:
	var times: PackedFloat32Array = track.times
	if times.is_empty(): return 0
	return int(track.values.size() / times.size())

## Linear (or slerp for quaternion tracks) sample of a keyframe track at `time`.
static func sample_track(track: Dictionary, time: float) -> PackedFloat32Array:
	var size := track_value_size(track)
	var times: PackedFloat32Array = track.times
	var values: PackedFloat32Array = track.values
	var left := 0
	while left < times.size() - 2 and times[left + 1] <= time: left += 1
	var right := mini(left + 1, times.size() - 1)
	var span := times[right] - times[left]
	var alpha := clampf((time - times[left]) / span, 0.0, 1.0) if span > 0.0 else 0.0
	if track.get("type") == "quaternion":
		var a := Quaternion(values[left * size], values[left * size + 1], values[left * size + 2], values[left * size + 3])
		var b := Quaternion(values[right * size], values[right * size + 1], values[right * size + 2], values[right * size + 3])
		var q := a.slerp(b, alpha)
		return PackedFloat32Array([q.x, q.y, q.z, q.w])
	var out := PackedFloat32Array()
	for component in size:
		out.append(lerpf(values[left * size + component], values[right * size + component], alpha))
	return out

## Rigidly places the basket in front of the torso and returns the independent
## handle-width scale needed to put both grip ends on the animated palms. The
## basket body itself is never scaled or deformed.
##
## The basket keeps one posture: level, squarely facing the rig's +Z and
## centred on the body axis. Its bar sits at the palms' height and reach, so
## it rides the torso bob, while the small sideways swing of the hands as the
## spine twists each step only slides them along the bar instead of rocking
## or yawing the whole basket. With the arm chain frozen while carrying, the
## palms are rigid to the torso and stay on the bar.
## Returns { position, quaternion, scale, handleScale }.
static func place_carry_socket(left_hand: Vector3, right_hand: Vector3) -> Dictionary:
	var midpoint := (left_hand + right_hand) * 0.5
	var hand_span := right_hand - left_hand
	var hand_distance := hand_span.length()
	return {
		"position": Vector3(0.0, midpoint.y - HARVEST_BASKET_GRIP_HEIGHT, midpoint.z + HARVEST_BASKET_GRIP_REACH),
		"quaternion": Quaternion.IDENTITY,
		"scale": Vector3.ONE,
		"handleScale": 1.0 if hand_distance < 1e-5 else hand_distance / (HARVEST_BASKET_GRIP_HALF_WIDTH * 2.0),
	}

## Node adapter of place_carry_socket; returns the handle scale.
static func apply_carry_socket(socket: Node3D, left_hand: Vector3, right_hand: Vector3) -> float:
	var placement := place_carry_socket(left_hand, right_hand)
	apply_placement(socket, placement)
	return placement.handleScale

# --- Godot Animation resource adapters -------------------------------------

## Converts a Godot Animation (GLB import: position_3d/rotation_3d/scale_3d
## tracks on "Skeleton3D:Bone" paths) into the Dictionary clip model.
static func clip_from_animation(animation: Animation, name: String) -> Dictionary:
	var tracks := []
	for index in animation.get_track_count():
		var path := String(animation.track_get_path(index))
		var bone := path.get_slice(":", 1) if path.contains(":") else path
		var type := animation.track_get_type(index)
		var property := ""
		var kind := ""
		match type:
			Animation.TYPE_POSITION_3D: property = "position"; kind = "vector"
			Animation.TYPE_ROTATION_3D: property = "quaternion"; kind = "quaternion"
			Animation.TYPE_SCALE_3D: property = "scale"; kind = "vector"
			_: continue
		var times := PackedFloat32Array()
		var values := PackedFloat32Array()
		for key in animation.track_get_key_count(index):
			times.append(animation.track_get_key_time(index, key))
			var value = animation.track_get_key_value(index, key)
			if kind == "quaternion": values.append_array(PackedFloat32Array([value.x, value.y, value.z, value.w]))
			else: values.append_array(PackedFloat32Array([value.x, value.y, value.z]))
		tracks.append({ "name": "%s.%s" % [bone, property], "times": times, "values": values, "type": kind, "path": path })
	return { "name": name, "duration": animation.length, "tracks": tracks }

## Builds a looping Godot Animation from a Dictionary clip.
static func animation_from_clip(clip: Dictionary, skeleton_path: String = "Skeleton3D") -> Animation:
	var animation := Animation.new()
	animation.length = clip.duration
	animation.loop_mode = Animation.LOOP_LINEAR
	for track in clip.tracks:
		var name: String = track.name
		var dot := JS.last_index_of(name, ".")
		var bone := name.substr(0, dot)
		var property := name.substr(dot + 1)
		var path: String = track.get("path", "%s:%s" % [skeleton_path, bone])
		var type := -1
		match property:
			"position": type = Animation.TYPE_POSITION_3D
			"quaternion": type = Animation.TYPE_ROTATION_3D
			"scale": type = Animation.TYPE_SCALE_3D
			_: continue
		var index := animation.add_track(type)
		animation.track_set_path(index, NodePath(path))
		var size := track_value_size(track)
		var times: PackedFloat32Array = track.times
		var values: PackedFloat32Array = track.values
		for key in times.size():
			var offset := key * size
			if type == Animation.TYPE_ROTATION_3D:
				animation.rotation_track_insert_key(index, times[key], Quaternion(values[offset], values[offset + 1], values[offset + 2], values[offset + 3]))
			elif type == Animation.TYPE_POSITION_3D:
				animation.position_track_insert_key(index, times[key], Vector3(values[offset], values[offset + 1], values[offset + 2]))
			else:
				animation.scale_track_insert_key(index, times[key], Vector3(values[offset], values[offset + 1], values[offset + 2]))
	return animation

static var _composed_libraries := {}

## Cached per loaded GLB: every body sharing the same source library reuses one
## composed set instead of rebuilding fifty clips on each spawn.
static func compose_carry_animation_library(library: AnimationLibrary) -> AnimationLibrary:
	var key := library.get_instance_id()
	if _composed_libraries.has(key): return _composed_libraries[key]
	var clips := []
	for animation_name in library.get_animation_list():
		clips.append(clip_from_animation(library.get_animation(animation_name), String(animation_name)))
	var composed := AnimationLibrary.new()
	for clip in compose_carry_animations(clips):
		composed.add_animation(StringName(clip.name), animation_from_clip(clip))
	_composed_libraries[key] = composed
	return composed
