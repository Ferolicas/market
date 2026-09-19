extends TestCase
## Port of src/game/navigation/NavMeshService.test.ts — only the assertions
## that do not need the Recast build/query are ported. The path-based cases
## ("keeps both lateral passages inaccessible...", "routes directly through
## the rear door...", "projects every authored farm-access waypoint...", and
## the route lengths of the socket case) wait for the NavigationServer3D
## backend behind NavMeshService.pathfinder_backend.

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

func test_store_pathfinder_is_empty_until_a_backend_is_installed() -> void:
	NavMeshService.pathfinder_backend = Callable()
	assert_false(NavMeshService.ensure_store_navigation(1))
	assert_eq(NavMeshService.store_pathfinder([0, 6.25], StoreServiceLayout.CART_RETURN_POINT), [])
	NavMeshService.pathfinder_backend = func(start: Array, end: Array) -> Array: return [[start[0], start[1]], [end[0], end[1]]]
	assert_true(NavMeshService.ensure_store_navigation(2))
	assert_eq(NavMeshService.store_pathfinder([0, 6.25], StoreServiceLayout.CART_RETURN_POINT), [[0, 6.25], StoreServiceLayout.CART_RETURN_POINT])
	NavMeshService.pathfinder_backend = Callable()

func test_walkable_geometry_covers_only_navigation_points() -> void:
	var geometry := NavMeshService.create_walkable_store_geometry()
	var positions: PackedVector3Array = geometry.positions
	var indices: PackedInt32Array = geometry.indices
	assert_eq(positions.size() % 4, 0)
	assert_eq(indices.size(), positions.size() / 4 * 6)
	for quad in range(0, positions.size(), 4):
		var center := [positions[quad].x + NavMeshService.NAVIGATION_CELL_SIZE / 2, positions[quad].z + NavMeshService.NAVIGATION_CELL_SIZE / 2]
		assert_true(NavMeshService.is_store_navigation_point(center))
