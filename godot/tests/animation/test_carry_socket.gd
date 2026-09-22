extends TestCase

func _track(name: String, type: String, times: Array, values: Array) -> Dictionary:
	return { "name": name, "type": type, "times": PackedFloat32Array(times), "values": PackedFloat32Array(values) }

func _clip(name: String, duration: float, tracks: Array) -> Dictionary:
	return { "name": name, "duration": duration, "tracks": tracks }

func _find_track(clip: Dictionary, name: String) -> Variant:
	return JS.find(clip.tracks, func(track): return track.name == name)

func _find_clip(clips: Array, name: String) -> Variant:
	return JS.find(clips, func(clip): return clip.name == name)

func _all_finite(values: Array) -> bool:
	return JS.every(values, func(v): return is_finite(v))

func test_keeps_checkout_legs_standing_without_modifying_gesture_arms_or_source_clips() -> void:
	var idle := _clip("Idle", 1.0, [_track("Hips.position", "vector", [0, 1], [0, 1, 0, 0, 1, 0]), _track("Shin_L.quaternion", "quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])])
	var hips := _track("Hips.position", "vector", [0, 2], [0, 0.5, 0, 0, 0.4, 0])
	var hand := _track("Hand_R.position", "vector", [0, 2], [0, 0, 0, 1, 1, 1])
	var source := _clip("CheckoutItem", 2.0, [hips, hand])
	var result: Dictionary = _find_clip(CarrySocket.compose_runtime_animation_aliases([idle, source]), "CheckoutItem")
	assert_eq(Array(_find_track(result, "Hips.position").values), [0.0, 1.0, 0.0, 0.0, 1.0, 0.0])
	assert_true(is_same(_find_track(result, "Hand_R.position"), hand))
	assert_true(is_same(source.tracks[0], hips))
	assert_eq(source.tracks.size(), 2)

func test_calibrates_a_finite_visible_palm_socket_for_every_selectable_body() -> void:
	var keys := CarrySocket.CHARACTER_PALM_OFFSETS.keys()
	keys.sort()
	assert_eq(keys, ["adult-man", "adult-woman", "boy", "girl"])
	for offsets in CarrySocket.CHARACTER_PALM_OFFSETS.values():
		assert_true(_all_finite(offsets.left))
		assert_true(_all_finite(offsets.right))
		# Inside the hand: the palm runs along the bone's +Y for about 0.03 and
		# the fingers reach 0.10, so a grip point lies between them.
		for offset in [offsets.left, offsets.right]:
			assert_gt(offset[1], 0.02)
			assert_lt(offset[1], 0.08)
			assert_lt(JS.hypot(offset[0], offset[2]), 0.02)

func test_targets_the_visible_palm_instead_of_stopping_at_the_wrist_bone_origin() -> void:
	var hand := Node3D.new()
	hand.position = Vector3(0.2, 0.8, 0.4)
	hand.rotation = Vector3(0.35, -0.2, 0.1)
	var wrist := CarrySocket.world_transform_of(hand).origin
	var offset := [-0.285, -0.003, 0.009]
	var palm := CarrySocket.hand_palm_point_of(hand, offset)
	assert_near(palm.distance_to(wrist), Vector3(offset[0], offset[1], offset[2]).length(), 1e-5)
	assert_true(_all_finite([palm.x, palm.y, palm.z]))
	hand.free()

func test_articulates_the_handle_between_fixed_rim_mounts_and_both_palm_grips() -> void:
	var handle := Node3D.new()
	for name in ["BasketGripBar", "BasketHandleStayLeft", "BasketHandleStayRight", "BasketGripLeft", "BasketGripRight"]:
		var part := Node3D.new()
		part.name = name
		handle.add_child(part)
	CarrySocket.apply_harvest_basket_handle(handle, 1.8)
	var left_grip: Vector3 = handle.find_child("BasketGripLeft", true, false).position
	var right_grip: Vector3 = handle.find_child("BasketGripRight", true, false).position
	var bar: Node3D = handle.find_child("BasketGripBar", true, false)
	var bar_a := CarrySocket.world_transform_of(bar) * Vector3(0, -0.5, 0)
	var bar_b := CarrySocket.world_transform_of(bar) * Vector3(0, 0.5, 0)
	assert_lt(minf(bar_a.distance_to(left_grip), bar_b.distance_to(left_grip)), 1e-6)
	assert_lt(minf(bar_a.distance_to(right_grip), bar_b.distance_to(right_grip)), 1e-6)
	assert_eq(handle.scale, Vector3(1, 1, 1))
	handle.free()

func test_rebinds_the_mounted_handle_after_a_full_empty_full_carry_cycle() -> void:
	var socket := Node3D.new()
	var first_basket := Node3D.new()
	var first_handle := Node3D.new()
	first_handle.name = "HarvestBasketAdaptiveHandle"
	first_basket.add_child(first_handle)
	socket.add_child(first_basket)
	assert_true(is_same(CarrySocket.mounted_harvest_basket_handle(socket), first_handle))
	socket.remove_child(first_basket)
	assert_true(is_same(first_handle.get_parent(), first_basket))
	assert_null(CarrySocket.mounted_harvest_basket_handle(socket))
	var second_basket := Node3D.new()
	var second_handle := Node3D.new()
	second_handle.name = "HarvestBasketAdaptiveHandle"
	second_basket.add_child(second_handle)
	socket.add_child(second_basket)
	assert_true(is_same(CarrySocket.mounted_harvest_basket_handle(socket), second_handle))
	assert_false(is_same(CarrySocket.mounted_harvest_basket_handle(socket), first_handle))
	first_basket.free()
	socket.free()

func test_puts_the_bar_at_the_palms_height_and_reach_with_the_basket_centred_level_and_in_front() -> void:
	var socket := Node3D.new()
	var left := Vector3(-0.253, 0.554, -0.021)
	var right := Vector3(0.249, 0.554, 0.092)
	var handle_scale := CarrySocket.apply_carry_socket(socket, left, right)
	var bar := CarrySocket.world_transform_of(socket) * Vector3(0, CarrySocket.HARVEST_BASKET_GRIP_HEIGHT, -CarrySocket.HARVEST_BASKET_GRIP_REACH)
	assert_near(bar.x, 0.0, 1e-6)
	assert_near(bar.y, 0.554, 1e-6)
	assert_near(bar.z, (left.z + right.z) / 2.0, 1e-6)
	assert_lt(socket.quaternion.angle_to(Quaternion.IDENTITY), 1e-6)
	assert_gt(socket.position.z, maxf(left.z, right.z) + 0.15)
	assert_near(handle_scale, left.distance_to(right) / (CarrySocket.HARVEST_BASKET_GRIP_HALF_WIDTH * 2.0), 1e-6)
	assert_eq(socket.scale, Vector3(1, 1, 1))
	socket.free()

func test_faces_the_rigs_front_whichever_hand_comes_first_so_the_basket_never_swings_behind_the_body() -> void:
	# The delivered rigs face +Z with Hand_L on +X; the avatar passes the left
	# palm first, which used to flip the basket through the torso.
	var left_palm := Vector3(0.166, 0.368, 0.195)
	var right_palm := Vector3(-0.06, 0.371, 0.233)
	var socket := CarrySocket.place_carry_socket(left_palm, right_palm)
	var front: Vector3 = socket.quaternion * Vector3(0, 0, 1)
	assert_gt(front.z, 0.99)
	assert_gt(socket.position.z, maxf(left_palm.z, right_palm.z) + 0.15)
	var mirrored := CarrySocket.place_carry_socket(right_palm, left_palm)
	assert_lt(mirrored.quaternion.angle_to(socket.quaternion), 1e-6)
	assert_lt(mirrored.position.distance_to(socket.position), 1e-6)

func test_stays_level_and_square_however_the_hands_twist_so_the_basket_never_rocks_with_the_step() -> void:
	var socket := CarrySocket.place_carry_socket(Vector3(-0.31, 0.48, -0.13), Vector3(0.22, 0.61, 0.19))
	var up: Vector3 = socket.quaternion * Vector3(0, 1, 0)
	var right_axis: Vector3 = socket.quaternion * Vector3(1, 0, 0)
	assert_near(up.y, 1.0, 1e-6)
	assert_near(right_axis.x, 1.0, 1e-6)
	assert_eq(socket.position.x, 0.0)

func test_does_not_produce_an_invalid_transform_when_both_hands_briefly_share_a_point() -> void:
	var hand := Vector3(0, 0.6, 0.08)
	var socket := CarrySocket.place_carry_socket(hand, hand)
	assert_true(_all_finite([socket.position.x, socket.position.y, socket.position.z]))
	assert_true(_all_finite([socket.quaternion.x, socket.quaternion.y, socket.quaternion.z, socket.quaternion.w]))
	assert_true(_all_finite([socket.scale.x, socket.scale.y, socket.scale.z]))
	assert_eq(socket.handleScale, 1.0)

func test_freezes_the_clavicles_with_the_arms_so_the_walk_cannot_sway_the_carried_hands() -> void:
	var carry_walk := _clip("CarryWalk", 1.0, [
		_track("Clavicle_L.rotation[x]", "number", [0, 1], [-0.2, 0.2]),
		_track("Rig_Leg_L.rotation[x]", "number", [0, 1], [-0.4, 0.4]),
	])
	var checkout_bag := _clip("CheckoutBag", 20.0, [
		_track("Clavicle_L.rotation[x]", "number", [0, 13.8, 20], [0, 0.35, 0]),
		_track("Rig_Arm_L.rotation[x]", "number", [0, 13.8, 20], [0, 0.9, 0]),
	])
	var carry_box := _clip("CarryBox", 1.0, [_track("Rig_Arm_L.rotation[x]", "number", [0, 0.5, 1], [0, 1.2, 0])])
	var composed := CarrySocket.compose_carry_animations([carry_walk, checkout_bag, carry_box])
	var next_walk: Dictionary = _find_clip(composed, "CarryWalk")
	# CheckoutBag at 13.8 s wins over CarryBox, and the clavicle now follows it too.
	var clavicle := Array(_find_track(next_walk, "Clavicle_L.rotation[x]").values)
	assert_eq(clavicle.size(), 2)
	assert_near(clavicle[0], 0.35, 0.005); assert_near(clavicle[1], 0.35, 0.005)
	var arm := Array(_find_track(next_walk, "Rig_Arm_L.rotation[x]").values)
	assert_near(arm[0], 0.9, 0.005); assert_near(arm[1], 0.9, 0.005)
	assert_eq(Array(_find_track(next_walk, "Rig_Leg_L.rotation[x]").values), Array(carry_walk.tracks[1].values))

func test_combines_carry_leg_motion_with_a_stable_two_handed_arm_pose() -> void:
	var carry_walk := _clip("CarryWalk", 1.0, [
		_track("Rig_Leg_L.rotation[x]", "number", [0, 1], [-0.4, 0.4]),
		_track("Rig_Arm_L.rotation[x]", "number", [0, 1], [0, 0]),
	])
	var carry_idle := _clip("CarryIdle", 3.0, [_track("Rig_Arm_L.rotation[x]", "number", [0, 3], [0, 0])])
	# No CheckoutBag in this pack: the composer falls back to CarryBox.
	var carry_box := _clip("CarryBox", 1.0, [
		_track("Rig_Arm_L.rotation[x]", "number", [0, 0.5, 1], [0, 1.2, 0]),
		_track("Forearm_R.rotation[x]", "number", [0, 0.5, 1], [0, -0.8, 0]),
	])
	var walk := _clip("Walk", 1.0, [])
	var run := _clip("Run", 0.74, [
		_track("Rig_Leg_R.rotation[x]", "number", [0, 0.74], [-0.7, 0.7]),
		_track("Rig_Arm_L.rotation[x]", "number", [0, 0.74], [0.8, -0.8]),
	])
	var composed := CarrySocket.compose_carry_animations([carry_walk, carry_idle, carry_box, walk, run])
	var next_walk: Dictionary = _find_clip(composed, "CarryWalk")
	var next_idle: Dictionary = _find_clip(composed, "CarryIdle")
	var carry_run: Dictionary = _find_clip(composed, "CarryRun")
	assert_eq(Array(_find_track(next_walk, "Rig_Leg_L.rotation[x]").values), Array(carry_walk.tracks[0].values))
	var arm := Array(_find_track(next_walk, "Rig_Arm_L.rotation[x]").values)
	assert_near(arm[0], 1.2, 0.005); assert_near(arm[1], 1.2, 0.005)
	var forearm := Array(_find_track(next_idle, "Forearm_R.rotation[x]").values)
	assert_near(forearm[0], -0.8, 0.005); assert_near(forearm[1], -0.8, 0.005)
	assert_eq(carry_run.duration, run.duration)
	assert_eq(Array(_find_track(carry_run, "Rig_Leg_R.rotation[x]").values), Array(run.tracks[0].values))
	var run_arm := Array(_find_track(carry_run, "Rig_Arm_L.rotation[x]").values)
	assert_near(run_arm[0], 1.2, 0.005); assert_near(run_arm[1], 1.2, 0.005)
	assert_true(is_same(_find_clip(composed, "Walk"), walk))
	assert_true(is_same(_find_clip(composed, "Run"), run))

func test_fills_only_the_gameplay_names_absent_from_the_delivered_animation_pack() -> void:
	var walk := _clip("Walk", 1.0, [])
	var wait := _clip("Wait", 2.0, [])
	var authored_turn := _clip("TurnLeft", 0.7, [])
	var composed := CarrySocket.compose_runtime_animation_aliases([walk, wait, authored_turn])
	assert_true(is_same(_find_clip(composed, "TurnLeft"), authored_turn))
	assert_eq(_find_clip(composed, "TurnRight").duration, 1.0)
	assert_eq(_find_clip(composed, "Phone").duration, 2.0)

func test_round_trips_a_godot_animation_through_the_clip_model() -> void:
	var animation := Animation.new()
	animation.length = 2.0
	var index := animation.add_track(Animation.TYPE_ROTATION_3D)
	animation.track_set_path(index, NodePath("Skeleton3D:Hand_L"))
	animation.rotation_track_insert_key(index, 0.0, Quaternion.IDENTITY)
	animation.rotation_track_insert_key(index, 2.0, Quaternion(Vector3.UP, 0.5))
	var clip := CarrySocket.clip_from_animation(animation, "Wave")
	assert_eq(clip.tracks[0].name, "Hand_L.quaternion")
	assert_eq(clip.tracks[0].times.size(), 2)
	var back := CarrySocket.animation_from_clip(clip)
	assert_eq(back.length, 2.0)
	assert_eq(String(back.track_get_path(0)), "Skeleton3D:Hand_L")
	assert_eq(back.track_get_key_count(0), 2)

func _fixture_library() -> AnimationLibrary:
	var animation := Animation.new()
	animation.length = 1.0
	var library := AnimationLibrary.new()
	library.add_animation(&"Idle", animation)
	return library

## The glTF importer marks AnimationLibrary resource_local_to_scene, so a
## repeat spawn of the same customer/employee identity gets a *different*
## AnimationLibrary instance every single _load_rig() call even though it
## came from the same source .glb — get_instance_id() never matched between
## spawns, so the old cache silently missed every time and recomposed ~90ms
## of clips on every single actor creation (the real cause behind the
## in-game/startup hitches, per real device telemetry: compose ~90-95ms,
## the AnimationPlayer remove/add_animation_library calls it feeds ~0-1ms).
func test_caches_by_the_given_key_not_by_the_librarys_own_instance_id() -> void:
	var first_instance := _fixture_library()
	var second_instance := _fixture_library() # a different Resource, same source path in practice
	var first := CarrySocket.compose_carry_animation_library(first_instance, "owner_man.glb:default")
	var second := CarrySocket.compose_carry_animation_library(second_instance, "owner_man.glb:default")
	assert_true(is_same(first, second), "Same cache key must reuse the composed result even across different AnimationLibrary instances")

func test_still_separates_by_instance_id_when_no_cache_key_is_given() -> void:
	var first_instance := _fixture_library()
	var second_instance := _fixture_library()
	var first := CarrySocket.compose_carry_animation_library(first_instance)
	var second := CarrySocket.compose_carry_animation_library(second_instance)
	assert_false(is_same(first, second))
