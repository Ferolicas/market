extends TestCase
## Port of src/game/world-scale.test.ts

func test_expands_the_layout_without_changing_vertical_placement() -> void:
	assert_eq(WorldScale.scale_store_position([3, 1.25, -4]), [6, 1.25, -8])
	assert_eq(WorldScale.scale_store_point([-2, 5]), [-4, 10])

func test_keeps_character_layout_and_element_scales_independent() -> void:
	assert_eq(WorldScale.WORLD_SCALE, 3)
	assert_eq(WorldScale.STORE_LAYOUT_SCALE, 2)
	assert_eq(WorldScale.STORE_ELEMENT_SCALE, 1.6)

func test_detects_enlarged_furniture_footprints() -> void:
	assert_true(WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point([-1.9, -7.9]), 0.4))
	assert_false(WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point([3.1, 0.45]), 0.4))

func test_shares_both_rear_door_corridor_fences_with_physics_and_navigation() -> void:
	var fences: Array = FarmLayout.FARM_GATE.accessCorridorFences
	for index in fences.size():
		var fence: Dictionary = fences[index]
		var center := WorldScale.scale_store_point([fence.center[0], fence.center[2]])
		assert_true(WorldScale.overlaps_store_obstacle(center, 0))
		assert_true(JS.some(WorldScale.STORE_OBSTACLES, func(obstacle): return obstacle.x == center[0] \
			and obstacle.z == center[1] \
			and obstacle.halfZ == fence.halfZ * WorldScale.STORE_ELEMENT_SCALE))
		assert_eq(fence.center[0], FarmLayout.FARM_GATE.frontPost[0] if index == 0 else FarmLayout.FARM_GATE.innerPost[0])

func test_keeps_the_lateral_pockets_sealed_at_their_perimeter_ends() -> void:
	for fence in FarmLayout.FARM_GATE.perimeterWallFences:
		var center := WorldScale.scale_store_point([fence.center[0], fence.center[2]])
		assert_true(WorldScale.overlaps_store_obstacle(center, 0))
		assert_true(JS.some(WorldScale.STORE_OBSTACLES, func(obstacle): return obstacle.x == center[0] \
			and obstacle.z == center[1] \
			and obstacle.halfZ == fence.halfZ * WorldScale.STORE_ELEMENT_SCALE))

func test_shares_solid_service_fixture_footprints_while_keeping_their_front_sockets_walkable() -> void:
	var navigation_padding := 0.31 * WorldScale.STORE_LAYOUT_SCALE
	for fixture_id in StoreServiceLayout.STORE_SERVICE_FIXTURE_IDS:
		var fixture: Dictionary = StoreServiceLayout.STORE_SERVICE_FIXTURES[fixture_id]
		var center := WorldScale.scale_store_point([fixture.position[0], fixture.position[2]])
		var obstacle = JS.find(WorldScale.STORE_OBSTACLES, func(candidate): return candidate.get("id") == fixture.obstacleId)
		assert_not_null(obstacle, fixture_id)
		assert_true(WorldScale.overlaps_store_obstacle(center, 0), "%s center" % fixture_id)
		assert_near(obstacle.halfX, fixture.footprint.halfX * WorldScale.STORE_ELEMENT_SCALE, 0.005)
		assert_near(obstacle.halfZ, fixture.footprint.halfZ * WorldScale.STORE_ELEMENT_SCALE, 0.005)

	assert_false(WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point(StoreServiceLayout.RETURNS_POINT), navigation_padding))
	assert_false(WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point(StoreServiceLayout.CART_RETURN_POINT), navigation_padding))
	assert_true(WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point([9.75, 5.55]), navigation_padding))
	assert_true(WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point([2.65, 6.35]), navigation_padding))

func test_shares_every_visible_production_machine_footprint_with_physics_and_navigation() -> void:
	for fixture in WorldScale.STORE_PRODUCTION_FIXTURES.values():
		var obstacle = JS.find(WorldScale.STORE_OBSTACLES, func(candidate): return candidate.get("id") == fixture.obstacleId)
		var expected_x: float = fixture.position[0] * WorldScale.STORE_LAYOUT_SCALE + fixture.localFootprint.centerX * WorldScale.STORE_ELEMENT_SCALE
		var expected_z: float = fixture.position[2] * WorldScale.STORE_LAYOUT_SCALE + fixture.localFootprint.centerZ * WorldScale.STORE_ELEMENT_SCALE

		assert_not_null(obstacle, fixture.obstacleId)
		assert_near(obstacle.x, expected_x, 0.005)
		assert_near(obstacle.z, expected_z, 0.005)
		assert_near(obstacle.halfX, fixture.localFootprint.halfX * WorldScale.STORE_ELEMENT_SCALE, 0.005)
		assert_near(obstacle.halfZ, fixture.localFootprint.halfZ * WorldScale.STORE_ELEMENT_SCALE, 0.005)
		assert_true(WorldScale.overlaps_store_obstacle([expected_x, expected_z], 0, ["corn-canner"]), fixture.obstacleId)

func test_shares_every_glass_production_room_wall_with_physics_and_navigation() -> void:
	for wall in ProductionLayout.PRODUCTION_CUBICLE.walls:
		var obstacle = JS.find(WorldScale.STORE_OBSTACLES, func(candidate): return candidate.get("id") == wall.id)
		assert_not_null(obstacle, wall.id)
		assert_near(obstacle.x, wall.position[0] * WorldScale.STORE_LAYOUT_SCALE, 0.005)
		assert_near(obstacle.z, wall.position[2] * WorldScale.STORE_LAYOUT_SCALE, 0.005)
		assert_near(obstacle.halfX, wall.halfX * WorldScale.STORE_LAYOUT_SCALE, 0.005)
		assert_near(obstacle.halfZ, wall.halfZ * WorldScale.STORE_LAYOUT_SCALE, 0.005)
		assert_true(WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point([wall.position[0], wall.position[2]]), 0))

func test_shares_the_visible_warehouse_return_crate_with_physics_and_navigation() -> void:
	var station: Dictionary = WarehouseLayout.WAREHOUSE_RETURN_STATION
	var obstacle = JS.find(WorldScale.STORE_OBSTACLES, func(candidate): return candidate.get("id") == station.obstacleId)
	var center := WorldScale.scale_store_point([station.position[0], station.position[2]])

	assert_not_null(obstacle)
	assert_near(obstacle.x, center[0], 0.005)
	assert_near(obstacle.z, center[1], 0.005)
	assert_near(obstacle.halfX, station.footprint.halfX * WorldScale.STORE_ELEMENT_SCALE, 0.005)
	assert_near(obstacle.halfZ, station.footprint.halfZ * WorldScale.STORE_ELEMENT_SCALE, 0.005)
	assert_true(WorldScale.overlaps_store_obstacle(center, 0))

func test_keeps_the_pre_recast_returns_route_outside_every_padded_fixture() -> void:
	var navigation_padding := 0.31 * WorldScale.STORE_LAYOUT_SCALE
	var route: Array = [StoreServiceLayout.RETURNS_POINT] + StoreServiceLayout.RETURNS_TO_CART_FALLBACK
	for index in range(1, route.size()):
		var start: Array = route[index - 1]
		var end: Array = route[index]
		var distance := JS.hypot(end[0] - start[0], end[1] - start[1])
		var steps := maxi(1, JS.ceil(distance / 0.04))
		for step in steps + 1:
			var progress := float(step) / steps
			var point := [
				start[0] + (end[0] - start[0]) * progress,
				start[1] + (end[1] - start[1]) * progress,
			]
			assert_false(WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point(point), navigation_padding), "segment %d at %s" % [index, point])
