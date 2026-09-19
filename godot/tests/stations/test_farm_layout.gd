extends TestCase
## Port of src/game/stations/farm-layout.test.ts

const STORE_REAR_WALL_Z = -8.55
const STORE_LAYOUT_SCALE = 2
const STORE_ELEMENT_SCALE = 1.6
const EMPLOYEE_CLEARANCE = 0.31 * STORE_LAYOUT_SCALE

func _segment_intersects_expanded_obstacle(start: Array, end: Array, obstacle: Dictionary) -> bool:
	var a := [start[0] * STORE_LAYOUT_SCALE, start[1] * STORE_LAYOUT_SCALE]
	var b := [end[0] * STORE_LAYOUT_SCALE, end[1] * STORE_LAYOUT_SCALE]
	var center := [obstacle.x * STORE_LAYOUT_SCALE, obstacle.z * STORE_LAYOUT_SCALE]
	var half := [
		obstacle.halfX * STORE_ELEMENT_SCALE + EMPLOYEE_CLEARANCE,
		obstacle.halfZ * STORE_ELEMENT_SCALE + EMPLOYEE_CLEARANCE,
	]
	var minimum := 0.0
	var maximum := 1.0

	for axis in [0, 1]:
		var delta: float = b[axis] - a[axis]
		var lower: float = center[axis] - half[axis]
		var upper: float = center[axis] + half[axis]
		if absf(delta) < 1e-8:
			if a[axis] < lower or a[axis] > upper: return false
			continue
		var first := (lower - a[axis]) / delta
		var second := (upper - a[axis]) / delta
		minimum = maxf(minimum, minf(first, second))
		maximum = minf(maximum, maxf(first, second))
		if minimum > maximum: return false
	return true

func _expect_obstacle_free_route(label: String, points: Array) -> void:
	for index in range(1, points.size()):
		var start: Array = points[index - 1]
		var point: Array = points[index]
		var hits := JS.filter(FarmLayout.FARM_OBSTACLES, func(obstacle): return _segment_intersects_expanded_obstacle(start, point, obstacle))
		assert_eq(hits, [], "%s: unsafe segment %s -> %s" % [label, start, point])

func _entrance() -> Array:
	return [FarmLayout.FARM_FIELD.entrance[0], FarmLayout.FARM_FIELD.entrance[2]]

func test_keeps_the_complete_estate_behind_the_supermarket_instead_of_on_the_facade() -> void:
	var field: Dictionary = FarmLayout.FARM_FIELD
	var field_front_edge: float = field.center[2] + field.size[2] / 2
	assert_lt(field_front_edge, STORE_REAR_WALL_Z - 1.5)

	var estate_positions := JS.map(FarmLayout.FARM_PLOTS, func(plot): return plot.position)
	estate_positions.append_array(JS.map(FarmLayout.FARM_ANIMAL_STATIONS.values(), func(station): return station.position))
	var half_width: float = field.size[0] / 2
	var half_depth: float = field.size[2] / 2
	for position in estate_positions:
		assert_lte(absf(position[0] - field.center[0]), half_width)
		assert_lte(absf(position[2] - field.center[2]), half_depth)
		assert_lt(position[2], STORE_REAR_WALL_Z)

func test_keeps_everything_the_owner_uses_or_sees_past_the_strip_the_rear_wall_hides_from_the_camera() -> void:
	# Wall 5.6 high, camera rising 23 for every 25.75 it travels along z:
	# the ground within 3.13 layout units behind the wall is invisible.
	assert_near(FarmLayout.FARM_WALL_SHADOW_DEPTH, 5.6 * 25.75 / 23 / STORE_LAYOUT_SCALE, 0.0005)
	assert_near(FarmLayout.FARM_VISIBLE_FRONT_Z, -8.55 - FarmLayout.FARM_WALL_SHADOW_DEPTH, 0.0005)
	var margin := 0.3
	var must_be_visible := []
	for plot in FarmLayout.FARM_PLOTS:
		must_be_visible.append([plot.id, plot.position[2] + FarmLayout.FARM_PLOT_FOOTPRINT.halfZ * 0.8])
	for id in FarmLayout.FARM_ANIMAL_STATIONS:
		must_be_visible.append([id, FarmLayout.FARM_ANIMAL_STATIONS[id].position[2] + FarmLayout.FARM_ANIMAL_FOOTPRINTS[id].halfZ * 0.8])
	must_be_visible.append(["barn", FarmLayout.FARM_BARN.position[2] + FarmLayout.FARM_BARN.footprint.halfZ * 0.8])
	must_be_visible.append(["worker-home", FarmLayout.FARM_WORKER_HOME[1]])
	for id in FarmLayout.FARM_INTERIOR_WAYPOINTS:
		must_be_visible.append([id, FarmLayout.FARM_INTERIOR_WAYPOINTS[id][1]])
	for purchase in MartCampaign.OPENING_PURCHASES:
		if PurchaseLayout.PURCHASE_POSITIONS[purchase.id][2] < STORE_REAR_WALL_Z:
			must_be_visible.append(["ring:%s" % purchase.id, PurchaseLayout.PURCHASE_POSITIONS[purchase.id][2] + PurchaseMarker.PURCHASE_MARKER.halfSize * 0.8])
	for entry in must_be_visible:
		assert_lte(entry[1], FarmLayout.FARM_VISIBLE_FRONT_Z - margin, "%s front edge at z %s is in the wall's shadow" % [entry[0], entry[1]])
	# The strip behind the wall is only a corridor: no bed, pen or barn edge in it.
	for entry in must_be_visible:
		var id: String = entry[0]
		if id.begins_with("ring:") or id.begins_with("worker") or ["entranceApron", "cropJunction", "southCropJunction"].has(id): continue
		assert_lte(entry[1], FarmLayout.FARM_CORRIDOR_BACK_Z, "%s intrudes into the corridor strip" % id)

func test_recognises_every_retired_facade_station_without_classifying_the_rear_estate_or_main_door() -> void:
	var retired := [[-9.45, 10.1], [-7.05, 10.1], [-9.45, 11.75], [-7.05, 11.75], [-3.45, 9.65], [-1.5, 9.65]]
	for point in retired: assert_true(FarmLayout.is_retired_front_farm_point(point), str(point))
	for plot in FarmLayout.FARM_PLOTS: assert_false(FarmLayout.is_retired_front_farm_point([plot.position[0], plot.position[2]]))
	for station in FarmLayout.FARM_ANIMAL_STATIONS.values(): assert_false(FarmLayout.is_retired_front_farm_point([station.workPosition[0], station.workPosition[2]]))
	assert_false(FarmLayout.is_retired_front_farm_point([0, 8.35]))

func test_leaves_every_crop_animal_work_point_and_service_waypoint_walkable() -> void:
	var destinations := JS.map(FarmLayout.FARM_PLOTS, func(plot): return [plot.position[0], plot.position[2]])
	destinations.append_array(JS.map(FarmLayout.FARM_ANIMAL_STATIONS.values(), func(station): return [station.workPosition[0], station.workPosition[2]]))
	destinations.append_array(FarmLayout.FARM_ACCESS_WAYPOINTS)
	destinations.append_array(FarmLayout.FARM_INTERIOR_WAYPOINTS.values())

	for destination in destinations:
		assert_true(NavMeshService.is_store_navigation_point(destination), "%s must be walkable" % [destination])

func test_centres_the_logical_entrance_in_the_physically_clear_gap_between_its_posts() -> void:
	var gate: Dictionary = FarmLayout.FARM_GATE
	var field: Dictionary = FarmLayout.FARM_FIELD
	var front_post := [gate.frontPost[0], gate.frontPost[2]]
	var inner_post := [gate.innerPost[0], gate.innerPost[2]]
	var entrance := _entrance()
	assert_near(gate.center[0], (front_post[0] + inner_post[0]) / 2, 0.005)
	assert_near(gate.center[2], (front_post[1] + inner_post[1]) / 2, 0.005)
	assert_eq(entrance[0], gate.center[0])
	assert_lt(entrance[1], gate.center[2])
	assert_eq(gate.exteriorApproach[0], gate.center[0])
	assert_gt(gate.exteriorApproach[1], gate.center[2])
	assert_eq(FarmLayout.FARM_ACCESS_WAYPOINTS[0], StorefrontLayout.STORE_REAR_DOOR.insideApproach)
	assert_eq(FarmLayout.FARM_ACCESS_WAYPOINTS[1], StorefrontLayout.STORE_REAR_DOOR.outsideApproach)
	assert_gt(JS.hypot(entrance[0] - front_post[0], entrance[1] - front_post[1]), 0.75)
	assert_gt(JS.hypot(entrance[0] - inner_post[0], entrance[1] - inner_post[1]), 0.75)
	var left_fence_right: float = gate.leftFrontFence.center[0] + gate.leftFrontFence.halfX * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE)
	var right_front_fence_left: float = gate.rightFrontFence.center[0] - gate.rightFrontFence.halfX * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE)
	var right_front_fence_right: float = gate.rightFrontFence.center[0] + gate.rightFrontFence.halfX * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE)
	var right_fence_front: float = gate.rightFence.center[2] + gate.rightFence.halfZ * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE)
	var right_fence_rear: float = gate.rightFence.center[2] - gate.rightFence.halfZ * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE)
	assert_near(left_fence_right, gate.frontPost[0], 0.00005)
	assert_near(right_front_fence_left, gate.innerPost[0], 0.00005)
	assert_near(right_front_fence_right, field.center[0] + field.size[0] / 2, 0.00005)
	assert_near(right_fence_front, field.center[2] + field.size[2] / 2, 0.00005)
	assert_near(right_fence_rear, field.center[2] - field.size[2] / 2, 0.00005)
	assert_true(NavMeshService.is_store_navigation_point(entrance))
	_expect_obstacle_free_route("rear door through farm gate", FarmLayout.FARM_ACCESS_WAYPOINTS)

func test_channels_rear_door_traffic_directly_between_the_two_farm_gate_posts() -> void:
	var gate: Dictionary = FarmLayout.FARM_GATE
	var door: Dictionary = StorefrontLayout.STORE_REAR_DOOR
	var element_to_layout := STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE
	var door_farm_face_z: float = door.z - door.door.frameDepth / 2
	var estate_front_z: float = FarmLayout.FARM_FIELD.center[2] + FarmLayout.FARM_FIELD.size[2] / 2
	var clear_half_width: float = door.door.outerPostOffset - door.door.postWidth / 2
	var expected_xs := [
		door.x - clear_half_width,
		door.x + clear_half_width,
	]

	assert_eq(gate.accessCorridorFences.size(), 2)
	for index in gate.accessCorridorFences.size():
		var fence: Dictionary = gate.accessCorridorFences[index]
		var gate_end: float = fence.center[2] - fence.halfZ * element_to_layout
		var door_end: float = fence.center[2] + fence.halfZ * element_to_layout

		assert_eq(fence.side, -1 if index == 0 else 1)
		assert_near(fence.center[0], expected_xs[index], 0.0000005)
		assert_near(fence.center[0], gate.frontPost[0] if index == 0 else gate.innerPost[0], 0.0000005)
		assert_near(gate_end, estate_front_z, 0.0000005)
		assert_near(door_end, door_farm_face_z, 0.0000005)
		assert_false(NavMeshService.is_store_navigation_point([fence.center[0], fence.center[2]]))
		assert_true(NavMeshService.is_store_navigation_point([fence.center[0] - fence.side * 0.5, fence.center[2]]))

	assert_true(NavMeshService.is_store_navigation_point([door.x, gate.accessCorridorFences[0].center[2]]))
	_expect_obstacle_free_route("rear-door chute remains open", FarmLayout.FARM_ACCESS_WAYPOINTS)

func test_also_seals_the_outer_ends_of_both_inaccessible_lateral_pockets() -> void:
	var gate: Dictionary = FarmLayout.FARM_GATE
	var door: Dictionary = StorefrontLayout.STORE_REAR_DOOR
	var element_to_layout := STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE
	var wall_outer_z: float = door.wallCenterZ - door.wallDepth / 2
	var estate_front_z: float = FarmLayout.FARM_FIELD.center[2] + FarmLayout.FARM_FIELD.size[2] / 2

	assert_eq(gate.perimeterWallFences.size(), 2)
	for fence in gate.perimeterWallFences:
		assert_near(fence.center[0], fence.side * FarmLayout.FARM_FIELD.size[0] / 2, 0.0000005)
		assert_near(fence.center[2] - fence.halfZ * element_to_layout, estate_front_z, 0.0000005)
		assert_near(fence.center[2] + fence.halfZ * element_to_layout, wall_outer_z, 0.0000005)
		assert_false(NavMeshService.is_store_navigation_point([fence.center[0], fence.center[2]]))

func test_keeps_the_visible_open_leaf_terminal_post_inside_its_canonical_collider() -> void:
	var gate: Dictionary = FarmLayout.FARM_GATE
	var terminal := FarmLayout.farm_gate_open_leaf_terminal_post(STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE)
	var direction_z := JS.sign_of(gate.openLeaf.center[2] - gate.innerPost[2])
	var visible_far_edge: float = terminal[1] * STORE_LAYOUT_SCALE \
		+ direction_z * gate.openLeaf.terminalPostDepth * STORE_ELEMENT_SCALE / 2
	var collider_far_edge: float = gate.openLeaf.center[2] * STORE_LAYOUT_SCALE \
		+ direction_z * gate.openLeaf.halfZ * STORE_ELEMENT_SCALE

	assert_eq(terminal[0], gate.openLeaf.center[0])
	assert_near(visible_far_edge, collider_far_edge, 0.0000005)

func test_parks_a_full_width_gate_leaf_continuously_from_its_hinge_post() -> void:
	var gate: Dictionary = FarmLayout.FARM_GATE
	var direction_z := JS.sign_of(gate.openLeaf.center[2] - gate.innerPost[2])
	var leaf_half_depth: float = gate.openLeaf.halfZ * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE)
	var hinge_edge: float = gate.openLeaf.center[2] - direction_z * leaf_half_depth
	var rendered_leaf_length: float = gate.openLeaf.halfZ * 2 * STORE_ELEMENT_SCALE
	var rendered_opening_width: float = absf(gate.innerPost[0] - gate.frontPost[0]) * STORE_LAYOUT_SCALE

	assert_near(hinge_edge, gate.innerPost[2], 0.0000005)
	assert_near(rendered_leaf_length, rendered_opening_width, 0.0000005)

func test_uses_the_same_obstacle_free_interior_corridor_in_both_directions_without_recast() -> void:
	var entrance := _entrance()
	var destinations := JS.map(FarmLayout.FARM_PLOTS, func(plot): return [plot.id, [plot.position[0], plot.position[2]]])
	for id in FarmLayout.FARM_ANIMAL_STATIONS:
		var station: Dictionary = FarmLayout.FARM_ANIMAL_STATIONS[id]
		destinations.append([id, [station.workPosition[0], station.workPosition[2]]])

	for entry in destinations:
		var id: String = entry[0]
		var destination: Array = entry[1]
		var outbound: Array = [entrance] + FarmLayout.farm_interior_route_from_entrance(destination)
		var inbound: Array = [destination] + FarmLayout.farm_interior_route_to_entrance(destination)
		assert_eq(JS.at(outbound, -1), destination, "%s outbound endpoint" % id)
		assert_eq(JS.at(inbound, -1), entrance, "%s inbound endpoint" % id)
		_expect_obstacle_free_route("%s gate to destination" % id, outbound)
		_expect_obstacle_free_route("%s destination to gate" % id, inbound)

func test_uses_the_shortest_obstacle_safe_visibility_route_between_farm_stations() -> void:
	var destinations: Array = [FarmLayout.FARM_WORKER_HOME]
	destinations.append_array(JS.map(FarmLayout.FARM_PLOTS, func(plot): return [plot.position[0], plot.position[2]]))
	destinations.append_array(JS.map(FarmLayout.FARM_ANIMAL_STATIONS.values(), func(station): return [station.workPosition[0], station.workPosition[2]]))

	for start in destinations:
		for destination in destinations:
			var label := "%s → %s" % [start, destination]
			var route := FarmLayout.farm_interior_route_between(start, destination)
			var points: Array = [start] + route
			if JS.hypot(start[0] - destination[0], start[1] - destination[1]) <= 0.08: assert_eq(route, [])
			else: assert_eq(JS.at(route, -1), destination)
			assert_eq(JS.unique(JS.map(points, func(point): return "%s:%s" % [point[0], point[1]])).size(), points.size(), label)
			_expect_obstacle_free_route(label, points)
			var path_length := 0.0
			for index in range(1, points.size()):
				path_length += JS.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1])
			var direct_distance := JS.hypot(start[0] - destination[0], start[1] - destination[1])
			assert_lte(path_length, direct_distance * 3 + 1, "%s excessive detour" % label)

func test_grows_the_coffee_at_the_right_end_of_the_front_row_by_the_gate_and_against_the_east_fence() -> void:
	var gate: Dictionary = FarmLayout.FARM_GATE
	var coffee: Dictionary = FarmLayout.farm_plot_by_id("crop-coffee-1")
	var orange: Dictionary = FarmLayout.farm_plot_by_id("crop-orange-1")
	var element_to_layout := STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE
	var footprint: Dictionary = FarmLayout.FARM_PLOT_FOOTPRINT
	assert_eq(coffee.productId, "coffee")
	assert_lt(coffee.position[2] + footprint.halfZ * element_to_layout, gate.openLeaf.center[2] - gate.openLeaf.halfZ * element_to_layout)
	assert_gt(coffee.position[0], orange.position[0])
	# Timbers end on the fence line, never through it, with a walk between the beds.
	assert_lte(coffee.position[0] + footprint.halfX * element_to_layout, gate.rightFence.center[0])
	assert_gt(coffee.position[0] - footprint.halfX * element_to_layout, orange.position[0] + footprint.halfX * element_to_layout + 1)
	# In front of the second chicken pen, the one beside the gate.
	var chicken2: Dictionary = FarmLayout.FARM_ANIMAL_STATIONS.chicken2
	assert_lt(absf(coffee.position[0] - chicken2.position[0]), FarmLayout.FARM_ANIMAL_FOOTPRINTS.chicken2.halfX * element_to_layout)
	assert_gt(coffee.position[2], chicken2.position[2])

func test_spaces_crop_magnets_so_one_pass_targets_one_coherent_bed_at_a_time() -> void:
	var plots: Array = FarmLayout.FARM_PLOTS
	for index in plots.size():
		var plot: Dictionary = plots[index]
		for other in JS.slice(plots, index + 1):
			var distance := JS.hypot(plot.position[0] - other.position[0], plot.position[2] - other.position[2])
			assert_gt(distance, 2.6)

func test_keeps_farm_interaction_ids_stable_and_reversible_after_relocation() -> void:
	for plot in FarmLayout.FARM_PLOTS:
		var interaction_id = FarmLayout.farm_interaction_id(plot.id)
		assert_not_null(interaction_id)
		assert_true(FarmLayout.is_farm_interaction_id(interaction_id))
		assert_eq(FarmLayout.crop_id_from_farm_interaction(interaction_id), plot.id)
		assert_true(is_same(FarmLayout.farm_plot_by_id(plot.id), plot))
	assert_null(FarmLayout.farm_interaction_id("crop-unknown"))
	assert_null(FarmLayout.crop_id_from_farm_interaction("farm:crop-unknown"))
