extends TestCase
## Port of src/game/stations/retail-layout.test.ts

const NAVMESH_FURNITURE_PADDING = 0.31 * WorldScale.STORE_LAYOUT_SCALE

func test_keeps_every_stocking_sensor_on_a_walkable_navmesh_lane() -> void:
	for department in RetailLayout.RETAIL_DEPARTMENTS.values():
		var service_point := WorldScale.scale_store_point(department.service)
		assert_false(
			WorldScale.overlaps_store_obstacle(service_point, NAVMESH_FURNITURE_PADDING),
			"%s service point is excluded from the NavMesh" % department.id,
		)

func test_gives_every_department_one_stable_and_reversible_magnet_id() -> void:
	var ids := JS.map(RetailLayout.RETAIL_DEPARTMENT_IDS, RetailLayout.stocking_interaction_id)

	assert_eq(JS.unique(ids).size(), RetailLayout.RETAIL_DEPARTMENT_IDS.size())
	for department_id in RetailLayout.RETAIL_DEPARTMENT_IDS:
		var id := RetailLayout.stocking_interaction_id(department_id)
		assert_true(RetailLayout.is_stocking_interaction_id(id))
		assert_eq(RetailLayout.retail_department_from_stocking_interaction(id), department_id)
	assert_false(RetailLayout.is_stocking_interaction_id("stock:unknown"))
	assert_null(RetailLayout.retail_department_from_stocking_interaction("checkout"))

func test_wraps_every_complete_fixture_and_detects_its_four_geometric_sides() -> void:
	for department_id in RetailLayout.RETAIL_DEPARTMENT_IDS:
		var magnet := RetailLayout.retail_stocking_magnet(department_id, WorldScale.STORE_LAYOUT_SCALE, WorldScale.STORE_ELEMENT_SCALE)
		var points := [
			[magnet.x - magnet.halfExtents[0] - magnet.enterRadius + 0.01, magnet.z],
			[magnet.x + magnet.halfExtents[0] + magnet.enterRadius - 0.01, magnet.z],
			[magnet.x, magnet.z - magnet.halfExtents[1] - magnet.enterRadius + 0.01],
			[magnet.x, magnet.z + magnet.halfExtents[1] + magnet.enterRadius - 0.01],
		]

		for point in points:
			var zone := InteractionZoneState.new({
				"id": RetailLayout.stocking_interaction_id(department_id),
				"type": "stock",
				"x": magnet.x,
				"z": magnet.z,
				"halfExtents": magnet.halfExtents,
				"enterRadius": magnet.enterRadius,
				"exitRadius": magnet.exitRadius,
				"actorMask": ["player"],
				"priority": 80,
				"dwellMs": 0,
				"repeatEveryMs": 180,
				"channel": "transfer",
			})
			assert_eq(JS.map(zone.update("player", point[0], point[1], 0), func(event): return event["signal"]), ["enter", "tick"], "%s@%s,%s" % [department_id, point[0], point[1]])

func test_keeps_department_magnets_disjoint_so_proximity_never_chooses_the_wrong_fixture() -> void:
	var magnets := []
	for department_id in RetailLayout.RETAIL_DEPARTMENT_IDS:
		magnets.append(JS.spread({ "departmentId": department_id }, RetailLayout.retail_stocking_magnet(department_id, WorldScale.STORE_LAYOUT_SCALE, WorldScale.STORE_ELEMENT_SCALE)))

	for index in magnets.size():
		var left: Dictionary = magnets[index]
		for right in JS.slice(magnets, index + 1):
			var overlaps_x: bool = absf(left.x - right.x) \
				< left.halfExtents[0] + right.halfExtents[0] + left.enterRadius + right.enterRadius
			var overlaps_z: bool = absf(left.z - right.z) \
				< left.halfExtents[1] + right.halfExtents[1] + left.enterRadius + right.enterRadius
			assert_false(overlaps_x and overlaps_z, "%s/%s" % [left.departmentId, right.departmentId])

func test_lands_each_product_on_its_real_first_rendered_shelf_instead_of_a_generic_height() -> void:
	assert_near(RetailLayout.retail_stock_landing_local_position("bread", 0, 1)[1], 0.42, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("flour", 0, 1)[1], 1.12, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("wheat", 0, 1)[1], 1.47, 0.005)
	assert_eq(RetailLayout.retail_stock_landing_local_position("coffee", 0, 1), [0, 0.38, 0.45])
	assert_near(RetailLayout.retail_stock_landing_local_position("eggs", 0, 1)[1], 0.295, 0.005)
	assert_eq(RetailLayout.retail_stock_landing_local_position("milk", 0, 1), [-0.55, 0.51, 0.18])
	assert_near(RetailLayout.retail_stock_landing_local_position("cheese", 0, 1)[1], 0.442, 0.005)
	assert_eq(RetailLayout.retail_stock_landing_local_position("juice", 0, 1), [0, 0.44, 0.24])

func test_spreads_units_over_every_level_of_the_front_row_before_using_deeper_rows() -> void:
	# Second unit climbs to the next shelf; the front row of every level is
	# complete before any unit moves one depth row back.
	assert_near(RetailLayout.retail_stock_landing_local_position("bread", 1, 2)[1], 0.77, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("bread", 2, 3)[1], 1.82, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("bread", 23, 24)[2], 0.16, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("bread", 24, 25)[2], 0, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("flour", 12, 13)[2], 0.04, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("flour", 24, 25)[2], -0.1, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("coffee", 1, 2)[1], 0.74, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("coffee", 40, 41)[2], 0.31, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("eggs", 1, 2)[1], 0.835, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("milk", 1, 2)[1], 0.78, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("juice", 1, 2)[1], 0.84, 0.005)
	# A partial front row stays centred on its shelf.
	assert_near(RetailLayout.retail_stock_landing_local_position("juice", 0, 1)[0], 0, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("juice", 0, 10)[0], -0.1, 0.005)
	assert_near(RetailLayout.retail_stock_landing_local_position("juice", 5, 10)[0], 0.1, 0.005)
	# Produce fills its bin back to front; the second layer only starts once
	# the deck is covered, and stays above the first layer.
	assert_gt(RetailLayout.retail_stock_landing_local_position("tomatoes", 3, 4)[2], RetailLayout.retail_stock_landing_local_position("tomatoes", 0, 1)[2])
	assert_gt(RetailLayout.retail_stock_landing_local_position("tomatoes", 15, 16)[1], RetailLayout.retail_stock_landing_local_position("tomatoes", 14, 15)[1] + 0.1)

func test_keeps_every_produce_unit_inside_the_bin_owned_by_its_sku() -> void:
	var half_bin: float = RetailLayout.PRODUCE_DECK.width / 2
	var products: Array = RetailLayout.RETAIL_DEPARTMENTS.produce.products
	for index in products.size():
		var product_id: String = products[index]
		assert_eq(RetailLayout.produce_bin_column(product_id), RetailLayout.PRODUCE_BIN_COLUMNS[index])
		for ordinal in RetailLayout.RETAIL_VISUAL_CAPACITY[product_id]:
			var landing := RetailLayout.retail_stock_landing_local_position(product_id, ordinal, RetailLayout.RETAIL_VISUAL_CAPACITY[product_id])
			assert_lt(absf(landing[0] - RetailLayout.PRODUCE_BIN_COLUMNS[index]), half_bin, "%s:%d x" % [product_id, ordinal])
			assert_lt(absf(landing[2] - RetailLayout.PRODUCE_DECK.center[2]), RetailLayout.PRODUCE_DECK.depth / 2, "%s:%d z" % [product_id, ordinal])
			assert_gt(landing[1], RetailLayout.PRODUCE_DECK.center[1] - RetailLayout.PRODUCE_DECK.depth / 2 * sin(RetailLayout.PRODUCE_DECK.tilt), "%s:%d y" % [product_id, ordinal])
	assert_eq(JS.unique(RetailLayout.PRODUCE_BIN_COLUMNS).size(), products.size())

func test_deals_units_and_capacity_round_robin_across_the_fixtures_of_a_department() -> void:
	assert_true(is_same(RetailLayout.retail_fixture_display_positions("produce"), RetailLayout.PRODUCE_DISPLAY_POSITIONS))
	assert_eq(RetailLayout.retail_fixture_display_positions("dairy"), [RetailLayout.RETAIL_DEPARTMENTS.dairy.display])
	assert_eq(JS.map([0, 1], func(fixture): return RetailLayout.distributed_fixture_quantity(7, fixture, 2)), [4, 3])
	assert_eq(JS.map([0, 1], func(fixture): return RetailLayout.distributed_fixture_quantity(12, fixture, 2)), [6, 6])
	assert_eq(JS.map([0, 1, 2], func(fixture): return RetailLayout.distributed_fixture_quantity(0, fixture, 3)), [0, 0, 0])

	# The seventh unit of a produce SKU is the fourth unit of the first table.
	assert_eq(RetailLayout.retail_stock_fixture_slot("produce", 6, 7), { "fixtureIndex": 0, "localOrdinal": 3, "localEnd": 4 })
	assert_eq(RetailLayout.retail_stock_fixture_slot("produce", 7, 8), { "fixtureIndex": 1, "localOrdinal": 3, "localEnd": 4 })
	assert_eq(RetailLayout.retail_stock_fixture_slot("dairy", 5, 6), { "fixtureIndex": 0, "localOrdinal": 5, "localEnd": 6 })
	for total in 27:
		var per_fixture := [0, 0]
		for ordinal in total: per_fixture[RetailLayout.retail_stock_fixture_slot("produce", ordinal, total).fixtureIndex] += 1
		assert_eq(per_fixture, [RetailLayout.distributed_fixture_quantity(total, 0, 2), RetailLayout.distributed_fixture_quantity(total, 1, 2)])

func test_creates_one_stocking_magnet_at_every_physical_fixture_instead_of_only_the_first() -> void:
	var pantry := RetailLayout.retail_stocking_magnets("pantry", 3, 2)
	var produce := RetailLayout.retail_stocking_magnets("produce", 3, 2)

	assert_eq(pantry.size(), RetailLayout.PANTRY_DISPLAY_POSITIONS.size())
	assert_eq(produce.size(), RetailLayout.PRODUCE_DISPLAY_POSITIONS.size())
	assert_eq(JS.map(pantry, func(magnet): return [magnet.x, magnet.z]), JS.map(RetailLayout.PANTRY_DISPLAY_POSITIONS, func(position): return [position[0] * 3, position[2] * 3]))
	assert_eq(JS.unique(JS.map(pantry, func(magnet): return magnet.fixtureIndex)).size(), RetailLayout.PANTRY_DISPLAY_POSITIONS.size())

func test_makes_tier_one_capacity_exactly_the_physical_front_slots_of_every_fixture() -> void:
	assert_eq(RetailLayout.RETAIL_FRONT_CAPACITY.bread, 24)
	assert_eq(RetailLayout.RETAIL_FRONT_CAPACITY.coffee, 40)
	assert_eq(RetailLayout.RETAIL_FRONT_CAPACITY.tomatoes, 15)
	assert_eq(RetailLayout.retail_shelf_capacity("tomatoes"), 30)
	assert_eq(RetailLayout.retail_shelf_capacity("coffee"), 80)
	assert_eq(RetailLayout.retail_shelf_capacity("bread"), 24)
	for product_id in RetailLayout.RETAIL_SHELF_GRIDS:
		var grid: Dictionary = RetailLayout.RETAIL_SHELF_GRIDS[product_id]
		var seen := {}
		var front: int = RetailLayout.RETAIL_FRONT_CAPACITY[product_id]
		for ordinal in front:
			var landing := RetailLayout.retail_stock_landing_local_position(product_id, ordinal, front)
			assert_near(landing[2], grid.frontZ, 0.005, "%s:%d stays on the front row at tier 1" % [product_id, ordinal])
			seen["%s:%s:%s" % [JS.to_fixed(landing[1], 4), JS.to_fixed(landing[2], 4), JS.to_fixed(RetailLayout.retail_stock_landing_local_position(product_id, ordinal, front)[0], 4)]] = true
		assert_eq(seen.size(), front, "%s front slots are distinct" % product_id)

func test_provides_a_finite_visible_slot_for_every_possible_tier_ten_unit_of_one_fixture() -> void:
	var maximum_multiplier: float = Levels.station_tier_modifiers(10).capacity
	for product_id in RetailLayout.PRODUCT_RETAIL_DEPARTMENT:
		var fixture_count := RetailLayout.retail_fixture_display_positions(RetailLayout.PRODUCT_RETAIL_DEPARTMENT[product_id]).size()
		var maximum := RetailLayout.distributed_fixture_quantity(JS.round(RetailLayout.retail_shelf_capacity(product_id) * maximum_multiplier), 0, fixture_count)
		assert_gte(RetailLayout.RETAIL_VISUAL_CAPACITY[product_id], maximum, product_id)
		var slots := {}
		for ordinal in maximum:
			var landing := RetailLayout.retail_stock_landing_local_position(product_id, ordinal, maximum)
			assert_true(JS.every(landing, JS.is_finite_number), "%s:%d" % [product_id, ordinal])
			slots[JS.join(JS.map(landing, func(coordinate): return JS.to_fixed(coordinate, 5)), ":")] = true
		assert_eq(slots.size(), maximum, "%s unique visual slots" % product_id)
