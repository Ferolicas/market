extends TestCase
## Geometry assertions plus real baked-path regressions from NavMeshService.test.ts.

func before_each() -> void:
	assert_true(NavMeshService.ensure_store_navigation(92001))

func after_each() -> void:
	NavMeshService.dispose_store_navigation()

func test_models_both_authored_doors_and_keeps_the_remaining_building_walls_solid() -> void:
	var rear: Dictionary = StorefrontLayout.STORE_REAR_DOOR
	assert_true(NavMeshService.is_store_navigation_point([0, 7.8]))
	assert_false(NavMeshService.is_store_navigation_point([4, 7.8]))
	assert_true(NavMeshService.is_store_navigation_point([rear.x, rear.z]))
	assert_false(NavMeshService.is_store_navigation_point([rear.x - 3, rear.z]))
	assert_false(NavMeshService.is_store_navigation_point([11.35, 0]))
	assert_true(NavMeshService.is_store_navigation_point([12.15, 7.8]))
	assert_true(NavMeshService.is_store_navigation_point([12.15, 0]))
	assert_true(NavMeshService.is_store_navigation_point([12.15, -8.45]))

func test_extends_beyond_the_rear_field_without_wasting_navigation_area() -> void:
	var field: Dictionary = FarmLayout.FARM_FIELD
	var field_rear_edge: float = field.center[2] - field.size[2] / 2
	assert_lt(NavMeshService.STORE_NAVIGATION_BOUNDS.minZ, field_rear_edge)
	assert_gt(NavMeshService.STORE_NAVIGATION_BOUNDS.minZ, field_rear_edge - 0.75)
	assert_gt(NavMeshService.STORE_NAVIGATION_BOUNDS.maxX, field.serviceLaneX)

func test_keeps_both_lateral_passages_inaccessible_from_the_rear_door_chute() -> void:
	for fence in FarmLayout.FARM_GATE.accessCorridorFences:
		assert_false(NavMeshService.is_store_navigation_point([fence.center[0], fence.center[2]]))

func test_keeps_entrance_checkout_returns_and_cart_bay_sockets_connected_outside_solid_fixtures() -> void:
	assert_true(NavMeshService.is_store_navigation_point(StoreServiceLayout.RETURNS_POINT))
	assert_true(NavMeshService.is_store_navigation_point(StoreServiceLayout.CART_RETURN_POINT))

func test_dispose_clears_navigation_and_rebuild_restores_queries() -> void:
	var service := NavMeshService.new()
	assert_eq(service.find_path(Vector3.ZERO, Vector3.ONE), [])
	assert_true(service.rebuild([], 1))
	assert_gt(service.find_path(Vector3(0, 0, 6.25), Vector3(0, 0, 7)).size(), 1)
	service.dispose()
	assert_eq(service.find_path(Vector3.ZERO, Vector3.ONE), [])
	assert_true(service.rebuild([], 1))
	service.dispose()

func test_walkable_geometry_covers_only_navigation_points() -> void:
	var geometry := NavMeshService.create_walkable_store_geometry()
	var positions: PackedVector3Array = geometry.positions
	var indices: PackedInt32Array = geometry.indices
	assert_eq(positions.size() % 4, 0)
	assert_eq(indices.size(), positions.size() / 4 * 6)
	for quad in range(0, positions.size(), 4):
		var center := [positions[quad].x + NavMeshService.NAVIGATION_CELL_SIZE / 2, positions[quad].z + NavMeshService.NAVIGATION_CELL_SIZE / 2]
		assert_true(NavMeshService.is_store_navigation_point(center))

func _path_length(start: Array, path: Array) -> float:
	var total := 0.0
	var previous := start
	for point in path:
		total += JS.hypot(point[0] - previous[0], point[1] - previous[1])
		previous = point
	return total

func _crossings(start: Array, path: Array, axis: int, coordinate: float) -> Array:
	var points := [start] + path
	var result := []
	for i in range(1, points.size()):
		var previous: Array = points[i - 1]
		var next: Array = points[i]
		if (previous[axis] - coordinate) * (next[axis] - coordinate) > 0 or absf(next[axis] - previous[axis]) < 1e-8: continue
		var progress: float = (coordinate - previous[axis]) / (next[axis] - previous[axis])
		if progress >= 0 and progress <= 1: result.append(previous[1 - axis] + (next[1 - axis] - previous[1 - axis]) * progress)
	return result

func test_real_routes_do_not_cross_rear_door_chute_fences() -> void:
	var start: Array = StorefrontLayout.STORE_REAR_DOOR.outsideApproach
	for fence in FarmLayout.FARM_GATE.accessCorridorFences:
		var destination := [fence.center[0] + fence.side * 1.2, fence.center[2]]
		var path := NavMeshService.store_pathfinder(start, destination)
		assert_gt(path.size(), 1)
		if path.is_empty(): continue
		assert_gt(JS.hypot(path[-1][0] - destination[0], path[-1][1] - destination[1]), 0.9)
		for z in _crossings(start, path, 0, fence.center[0]):
			assert_false(z > FarmLayout.FARM_GATE.center[2] and z < StorefrontLayout.STORE_REAR_DOOR.z - StorefrontLayout.STORE_REAR_DOOR.door.frameDepth / 2)

func test_routes_through_rear_door_to_every_farm_destination() -> void:
	var start := [0, 6.25]
	var destinations := []
	for plot in FarmLayout.FARM_PLOTS: destinations.append([plot.id, [plot.position[0], plot.position[2]]])
	for id in FarmLayout.FARM_ANIMAL_STATIONS:
		var station: Dictionary = FarmLayout.FARM_ANIMAL_STATIONS[id]
		destinations.append([id, [station.workPosition[0], station.workPosition[2]]])
	for destination in destinations:
		var path := NavMeshService.store_pathfinder(start, destination[1])
		var id: String = destination[0]
		assert_gte(path.size(), 3, id)
		if path.is_empty(): continue
		assert_lt(JS.hypot(path[-1][0] - destination[1][0], path[-1][1] - destination[1][1]), 0.9, id)
		assert_false(path.any(func(point): return point[0] > 11.58), id)
		var crossings := _crossings(start, path, 1, StorefrontLayout.STORE_REAR_DOOR.z)
		assert_gt(crossings.size(), 0, id)
		if not crossings.is_empty(): assert_lt(absf(crossings[0] - StorefrontLayout.STORE_REAR_DOOR.x), StorefrontLayout.STORE_REAR_DOOR.door.outerPostOffset - StorefrontLayout.STORE_REAR_DOOR.door.postWidth / 2, id)
		assert_lt(_path_length(start, path), 40, id)

func test_farm_access_projection_meets_strict_arrival_tolerance() -> void:
	for i in range(1, FarmLayout.FARM_ACCESS_WAYPOINTS.size()):
		var destination: Array = FarmLayout.FARM_ACCESS_WAYPOINTS[i]
		var path := NavMeshService.store_pathfinder(FarmLayout.FARM_ACCESS_WAYPOINTS[i - 1], destination)
		assert_gt(path.size(), 1)
		if not path.is_empty(): assert_lt(JS.hypot(path[-1][0] - destination[0], path[-1][1] - destination[1]), 0.25)

func test_service_socket_route_lengths_and_clearance() -> void:
	var cases := [
		[[0, 6.25], StoreServiceLayout.CART_RETURN_POINT, 5],
		[[7, 2.85], StoreServiceLayout.RETURNS_POINT, 7],
		[StoreServiceLayout.RETURNS_POINT, StoreServiceLayout.CART_RETURN_POINT, 19],
		[StoreServiceLayout.CART_RETURN_POINT, [0, 6.25], 5],
	]
	for item in cases:
		var path := NavMeshService.store_pathfinder(item[0], item[1])
		assert_gt(path.size(), 1)
		assert_true(path.all(func(point): return NavMeshService.is_store_navigation_point(point)))
		if path.is_empty(): continue
		assert_lt(JS.hypot(path[-1][0] - item[1][0], path[-1][1] - item[1][1]), 0.9)
		assert_lt(_path_length(item[0], path), item[2])
