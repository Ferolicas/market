extends TestCase
## Port of src/game/stations/purchase-layout.test.ts

## Two squares must not overlap: their diagonal in layout units.
const SQUARE_SEPARATION = PurchaseMarker.PURCHASE_MARKER.halfSize * 2 * sqrt(2) * 0.8

func test_places_every_marker_on_a_walkable_cell_of_the_fullest_store_clear_of_obstacles() -> void:
	# `ensureStoreNavigation` (Recast) is not ported; the walkability predicate is.
	var areas: Array = FixtureAvailability.ALL_PURCHASED_AREAS
	for purchase in MartCampaign.OPENING_PURCHASES:
		var position: Array = PurchaseLayout.PURCHASE_POSITIONS[purchase.id]
		var point := [position[0], position[2]]
		assert_true(NavMeshService.is_store_navigation_point(point, areas), "%s is not reachable" % purchase.id)
		assert_false(WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point(point), 0.32 * WorldScale.STORE_LAYOUT_SCALE, areas), "%s overlaps a fixture" % purchase.id)

func test_keeps_every_marker_off_the_sockets_the_owner_works_from() -> void:
	for purchase in MartCampaign.OPENING_PURCHASES:
		var position: Array = PurchaseLayout.PURCHASE_POSITIONS[purchase.id]
		for socket in PurchaseLayout.PURCHASE_WORK_SOCKETS:
			var distance := JS.hypot(socket.point[0] - position[0], socket.point[1] - position[2])
			assert_gte(distance, PurchaseLayout.PURCHASE_MARKER_CLEARANCE, "%s sits on %s" % [purchase.id, socket.id])

func test_puts_each_elements_marker_at_a_corner_of_the_element_lower_left_first() -> void:
	var placements: Dictionary = PurchaseLayout.PURCHASE_MARKER_PLACEMENTS
	var cornered := JS.filter(MartCampaign.OPENING_PURCHASES, func(purchase): return placements[purchase.id].corner != "authored")
	# Every pen, bed, display and machine gets a corner; only the farmers,
	# the owner's own upgrade and the expansion stand on their own.
	var authored := JS.map(JS.filter(MartCampaign.OPENING_PURCHASES, func(purchase): return placements[purchase.id].corner == "authored"), func(purchase): return purchase.id)
	authored.sort()
	assert_eq(authored, ["expansion-1", "farmer-1", "farmer-2", "farmer-3", "player-2"])
	assert_gte(JS.filter(cornered, func(purchase): return placements[purchase.id].corner == "lower-left").size(), cornered.size() / 2.0)

func test_keeps_farm_markers_in_front_of_the_walls_shadow() -> void:
	for purchase in MartCampaign.OPENING_PURCHASES:
		var position: Array = PurchaseLayout.PURCHASE_POSITIONS[purchase.id]
		if position[2] > -9: continue
		assert_lte(position[2], FarmLayout.FARM_VISIBLE_FRONT_Z - 0.3, "%s hides behind the wall" % purchase.id)

func test_never_overlaps_two_markers_that_can_be_pending_at_the_same_time() -> void:
	var shared := {}
	for purchase in MartCampaign.OPENING_PURCHASES:
		var position: Array = PurchaseLayout.PURCHASE_POSITIONS[purchase.id]
		var key := "%s:%s" % [position[0], position[2]]
		shared[key] = JS.get_or(shared, key, []) + [purchase.id]
	for key in shared:
		var ids: Array = shared[key]
		# Only chains that unlock one after another may share a spot.
		if ids.size() == 1: continue
		for id in JS.slice(ids, 1):
			var definition: Dictionary = JS.find(MartCampaign.OPENING_PURCHASES, func(purchase): return purchase.id == id)
			var depends_on_sibling := JS.some(definition.requires, func(required): return ids.has(required))
			assert_true(depends_on_sibling, "%s shares a marker with an unrelated purchase" % id)
	for purchase in MartCampaign.OPENING_PURCHASES:
		for other in MartCampaign.OPENING_PURCHASES:
			if other.id == purchase.id: continue
			var a: Array = PurchaseLayout.PURCHASE_POSITIONS[purchase.id]
			var b: Array = PurchaseLayout.PURCHASE_POSITIONS[other.id]
			var distance := JS.hypot(a[0] - b[0], a[2] - b[2])
			if distance == 0: continue
			assert_gt(distance, SQUARE_SEPARATION, "%s and %s overlap" % [purchase.id, other.id])
