extends TestCase
## Port of src/game/interaction/magnet-contact.test.ts

## The owner's capsule radius in scaled simulation units.
const PLAYER_BODY_RADIUS = 0.24

func _solid_obstacle(id: String) -> Dictionary:
	var obstacle = JS.find(WorldScale.STORE_OBSTACLES, func(candidate): return candidate.get("id") == id)
	assert_not_null(obstacle, id)
	return obstacle

func test_reaches_only_as_far_as_a_body_brushing_the_fixture() -> void:
	var reach: Dictionary = InteractionZone.CONTACT_MAGNET_REACH
	assert_gt(reach.enter, PLAYER_BODY_RADIUS)
	assert_lt(reach.enter, PLAYER_BODY_RADIUS * 2)
	assert_gt(reach.exit, reach.enter)

## it.each([chicken, chicken2, cow])
func test_wraps_each_pen_exactly_on_its_solid_collider() -> void:
	for pen in [["chicken", "fixture:chicken-coop"], ["chicken2", "fixture:chicken-coop-2"], ["cow", "fixture:cow-station"]]:
		var magnet := FarmLayout.farm_animal_magnet(pen[0], WorldScale.STORE_LAYOUT_SCALE, WorldScale.STORE_ELEMENT_SCALE)
		var solid := _solid_obstacle(pen[1])
		assert_near(magnet.x, solid.x, 0.005)
		assert_near(magnet.z, solid.z, 0.005)
		assert_near(magnet.halfExtents[0], solid.halfX, 0.005)
		assert_near(magnet.halfExtents[1], solid.halfZ, 0.005)
		# Walking past, one full body width clear of the timbers: nothing.
		var clear: float = magnet.halfExtents[0] + PLAYER_BODY_RADIUS * 2 + 0.05
		assert_gt(InteractionZone.interaction_zone_planar_distance(magnet, magnet.x + clear, magnet.z), magnet.enterRadius)
		# Pressed against the pen (the collider keeps the centre one radius out): active.
		var touching: float = magnet.halfExtents[1] + PLAYER_BODY_RADIUS + 0.02
		assert_lte(InteractionZone.interaction_zone_planar_distance(magnet, magnet.x, magnet.z + touching), magnet.enterRadius)

func test_uses_the_same_contact_reach_for_machines_shelves_and_the_return_crate() -> void:
	var reach: Dictionary = InteractionZone.CONTACT_MAGNET_REACH
	for id in ProductionLayout.PRODUCTION_WORKSTATION_IDS:
		assert_eq(ProductionLayout.production_machine_magnet(id, WorldScale.STORE_LAYOUT_SCALE, WorldScale.STORE_ELEMENT_SCALE).enterRadius, reach.enter)
	for id in RetailLayout.RETAIL_DEPARTMENT_IDS:
		assert_eq(RetailLayout.retail_stocking_magnet(id, WorldScale.STORE_LAYOUT_SCALE, WorldScale.STORE_ELEMENT_SCALE).enterRadius, reach.enter)
	var station: Dictionary = WarehouseLayout.WAREHOUSE_RETURN_STATION
	assert_eq(station.enterRadius, reach.enter)
	var crate := _solid_obstacle(station.obstacleId)
	assert_near(station.footprint.halfX * WorldScale.STORE_ELEMENT_SCALE, crate.halfX, 0.005)
