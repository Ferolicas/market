extends TestCase
## Port of src/game/stations/storefront-layout.test.ts

func test_uses_double_height_leaves_and_clears_the_complete_framed_opening() -> void:
	var door: Dictionary = StorefrontLayout.STOREFRONT_LAYOUT.door

	assert_eq(door.leafHeight, 5.4)
	assert_eq(StorefrontLayout.storefront_door_leaf_center(-1, 0), -door.closedCenterOffset)
	assert_eq(StorefrontLayout.storefront_door_leaf_center(1, 1), door.closedCenterOffset + door.openTravel)
	assert_gte(StorefrontLayout.storefront_door_clear_width(1), door.outerPostX * 2)

func test_clamps_incomplete_or_invalid_animation_progress_before_placing_colliders() -> void:
	assert_eq(StorefrontLayout.storefront_door_progress(-1), 0.0)
	assert_eq(StorefrontLayout.storefront_door_progress(2), 1.0)
	assert_eq(StorefrontLayout.storefront_door_progress(NAN), 0.0)

func test_detects_actors_across_the_full_storefront_access_from_either_side() -> void:
	var sensor: Dictionary = StorefrontLayout.STOREFRONT_LAYOUT.sensor
	var left: float = sensor.centerX - sensor.actorHalfWidth
	var right: float = sensor.centerX + sensor.actorHalfWidth
	var inside: float = sensor.centerZ - sensor.actorHalfDepth
	var outside: float = sensor.centerZ + sensor.actorHalfDepth

	assert_true(StorefrontLayout.storefront_door_actor_present([left, sensor.centerZ]))
	assert_true(StorefrontLayout.storefront_door_actor_present([right, sensor.centerZ]))
	assert_true(StorefrontLayout.storefront_door_actor_present([sensor.centerX, inside]))
	assert_true(StorefrontLayout.storefront_door_actor_present([sensor.centerX, outside]))
	assert_false(StorefrontLayout.storefront_door_actor_present([left - 0.01, sensor.centerZ]))
	assert_false(StorefrontLayout.storefront_door_actor_present([sensor.centerX, outside + 0.01]))
	assert_gt(sensor.actorHalfWidth, StorefrontLayout.STOREFRONT_LAYOUT.door.outerPostX)

func test_authors_one_aligned_rear_opening_for_render_physics_and_navigation() -> void:
	var rear: Dictionary = StorefrontLayout.STORE_REAR_DOOR
	var door: Dictionary = rear.door
	var segments := StorefrontLayout.rear_door_wall_segments()
	var opening_half_width: float = door.outerPostOffset + door.postWidth / 2

	assert_eq(segments.size(), 2)
	assert_near(segments[0].centerX - segments[0].width / 2, -rear.wallHalfWidth, 0.0000005)
	assert_near(segments[0].centerX + segments[0].width / 2, rear.x - opening_half_width, 0.0000005)
	assert_near(segments[1].centerX - segments[1].width / 2, rear.x + opening_half_width, 0.0000005)
	assert_near(segments[1].centerX + segments[1].width / 2, rear.wallHalfWidth, 0.0000005)
	assert_near(StorefrontLayout.rear_door_leaf_center(-1, 0), rear.x - door.closedCenterOffset, 0.0000005)
	assert_near(StorefrontLayout.rear_door_leaf_center(1, 1), rear.x + door.closedCenterOffset + door.openTravel, 0.0000005)
	assert_gte(StorefrontLayout.rear_door_clear_width(1), door.outerPostOffset * 2)
	assert_eq(rear.insideApproach[0], rear.x)
	assert_eq(rear.outsideApproach[0], rear.x)

func test_keeps_every_decorative_rear_wall_panel_outside_the_physical_doorway() -> void:
	var wall_segments := StorefrontLayout.rear_door_wall_segments()

	for panel in StorefrontLayout.rear_door_wall_panels():
		var panel_left: float = panel.centerX - panel.width / 2
		var panel_right: float = panel.centerX + panel.width / 2
		var containing_wall = JS.find(wall_segments, func(segment): return panel_left >= segment.centerX - segment.width / 2 \
			and panel_right <= segment.centerX + segment.width / 2)
		assert_not_null(containing_wall, "panel %s/%s must remain on a solid wall" % [panel.centerX, panel.width])

func _advance_for(initial: Dictionary, occupied: bool, duration_ms: int) -> Dictionary:
	var state := initial.duplicate()
	var elapsed := 0
	while elapsed < duration_ms:
		state = StorefrontLayout.advance_rear_door_motion(state, occupied, mini(50, duration_ms - elapsed))
		elapsed += 50
	return state

func test_opens_before_an_actor_reaches_the_threshold_holds_then_closes_completely() -> void:
	var rear: Dictionary = StorefrontLayout.STORE_REAR_DOOR
	assert_true(StorefrontLayout.rear_door_actor_present(rear.insideApproach))
	assert_true(StorefrontLayout.rear_door_actor_present(rear.outsideApproach))
	assert_false(StorefrontLayout.rear_door_actor_present([rear.x - 3, rear.z]))

	var motion: Dictionary = StorefrontLayout.CLOSED_REAR_DOOR_MOTION.duplicate()
	motion = _advance_for(motion, true, rear.motion.openMs)
	assert_eq(motion, { "progress": 1, "emptyForMs": 0 })
	motion = _advance_for(motion, false, rear.motion.holdOpenMs - 1)
	assert_eq(motion.progress, 1.0)
	motion = StorefrontLayout.advance_rear_door_motion(motion, false, 1)
	assert_eq(motion.progress, 1.0)
	motion = _advance_for(motion, false, rear.motion.closeMs)
	assert_eq(motion.progress, 0.0)
