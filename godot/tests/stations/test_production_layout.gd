extends TestCase
## Port of src/game/stations/production-layout.test.ts

func _zone_for(id: String) -> Dictionary:
	var magnet := ProductionLayout.production_machine_magnet(id, WorldScale.STORE_LAYOUT_SCALE, WorldScale.STORE_ELEMENT_SCALE)
	return JS.spread(JS.spread({ "id": id, "type": id }, magnet), {
		"actorMask": ["player"],
		"priority": 70,
		"dwellMs": 0,
		"repeatEveryMs": 180,
		"channel": "transfer",
	})

## it.each(PRODUCTION_WORKSTATION_IDS)
func test_wraps_every_side_and_corner_of_each_workstation_with_one_magnet() -> void:
	for id in ProductionLayout.PRODUCTION_WORKSTATION_IDS:
		var zone := _zone_for(id)
		var half_x: float = zone.halfExtents[0]
		var half_z: float = zone.halfExtents[1]
		var corner_offset: float = zone.enterRadius * 0.68
		var samples := [
			[zone.x - half_x - zone.enterRadius * 0.95, zone.z],
			[zone.x + half_x + zone.enterRadius * 0.95, zone.z],
			[zone.x, zone.z - half_z - zone.enterRadius * 0.95],
			[zone.x, zone.z + half_z + zone.enterRadius * 0.95],
			[zone.x - half_x - corner_offset, zone.z - half_z - corner_offset],
			[zone.x + half_x + corner_offset, zone.z - half_z - corner_offset],
			[zone.x - half_x - corner_offset, zone.z + half_z + corner_offset],
			[zone.x + half_x + corner_offset, zone.z + half_z + corner_offset],
		]

		for sample in samples:
			assert_lte(InteractionZone.interaction_zone_planar_distance(zone, sample[0], sample[1]), zone.enterRadius, "%s at %s,%s" % [id, sample[0], sample[1]])

func test_keeps_every_automated_operator_socket_connected_through_the_glass_doorway() -> void:
	# The Recast path from the doorway is not ported (see NavMeshService TODOs);
	# the walkability of every socket is.
	for id in ProductionLayout.PRODUCTION_WORKSTATION_IDS:
		if id == "juice" or id == "canner": continue
		var target: Array = ProductionLayout.production_fixture_for_workstation(id).operatorWorkPoint
		assert_true(NavMeshService.is_store_navigation_point(target), id)

func test_keeps_the_front_glass_doorway_open_while_sealing_its_two_sides() -> void:
	var cubicle: Dictionary = ProductionLayout.PRODUCTION_CUBICLE
	var center_x: float = cubicle.doorway.centerX
	var front: float = cubicle.bounds.front
	assert_true(NavMeshService.is_store_navigation_point([center_x, front]))
	assert_true(NavMeshService.is_store_navigation_point([center_x, front - 0.55]))
	assert_false(NavMeshService.is_store_navigation_point([cubicle.walls[3].position[0], front]))
	assert_false(NavMeshService.is_store_navigation_point([cubicle.walls[4].position[0], front]))

func test_leaves_physical_player_clearance_around_all_four_sides_of_every_machine() -> void:
	var required_corridor := 2 * (0.24 / WorldScale.STORE_LAYOUT_SCALE)
	var bounds: Dictionary = ProductionLayout.PRODUCTION_CUBICLE.bounds
	for id in ProductionLayout.PRODUCTION_WORKSTATION_IDS:
		if id == "juice" or id == "canner": continue
		var fixture := ProductionLayout.production_fixture_for_workstation(id)
		var footprint: Dictionary = fixture.localFootprint
		var center_x: float = fixture.position[0] + footprint.centerX * WorldScale.STORE_ELEMENT_SCALE / WorldScale.STORE_LAYOUT_SCALE
		var center_z: float = fixture.position[2] + footprint.centerZ * WorldScale.STORE_ELEMENT_SCALE / WorldScale.STORE_LAYOUT_SCALE
		var half_x: float = footprint.halfX * WorldScale.STORE_ELEMENT_SCALE / WorldScale.STORE_LAYOUT_SCALE
		var half_z: float = footprint.halfZ * WorldScale.STORE_ELEMENT_SCALE / WorldScale.STORE_LAYOUT_SCALE
		var clearances := [
			center_x - half_x - bounds.left,
			bounds.right - center_x - half_x,
			center_z - half_z - bounds.rear,
			bounds.front - center_z - half_z,
		]
		for side in clearances.size():
			assert_gt(clearances[side], required_corridor, "%s side %d" % [id, side])

func test_keeps_the_juice_machine_outside_the_bakerys_right_glass() -> void:
	var fixture := ProductionLayout.production_fixture_for_workstation("juice")
	var footprint: Dictionary = fixture.localFootprint
	var right_edge: float = fixture.position[0] \
		+ (footprint.centerX + footprint.halfX) * WorldScale.STORE_ELEMENT_SCALE / WorldScale.STORE_LAYOUT_SCALE

	assert_eq(fixture.yaw, 0)
	assert_gt(right_edge, ProductionLayout.PRODUCTION_CUBICLE.bounds.right)
