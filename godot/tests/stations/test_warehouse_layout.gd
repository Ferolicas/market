extends TestCase
## Port of src/game/stations/warehouse-layout.test.ts. The Recast route checks
## (`ensureStoreNavigation`/`storePathfinder`) are not ported; the pure
## walkability and layout assertions are.

func test_keeps_the_orders_terminal_on_an_accessible_recast_cell_beside_the_real_dock() -> void:
	var terminal: Dictionary = WarehouseLayout.WAREHOUSE_ORDERS_TERMINAL
	var point := [terminal.position[0], terminal.position[2]]

	assert_true(NavMeshService.is_store_navigation_point(point))
	assert_false(WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point(point), 0.31 * WorldScale.STORE_LAYOUT_SCALE))
	assert_eq(terminal.label, "Pedidos y almacén")

func test_keeps_the_worker_return_point_reachable_beside_the_rear_farm_door() -> void:
	var station: Dictionary = WarehouseLayout.WAREHOUSE_RETURN_STATION
	var point := [station.position[0], station.position[2]]

	var approach := [station.workerPosition[0], station.workerPosition[1]]
	assert_true(NavMeshService.is_store_navigation_point(approach))
	assert_false(WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point(approach), 0.31 * WorldScale.STORE_LAYOUT_SCALE))

	assert_true(WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point(point), 0))
	assert_eq(station.interactionId, "warehouseReturn")
	assert_gt(station.repeatEveryMs, 0)
