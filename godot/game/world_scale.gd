class_name WorldScale
extends RefCounted
## Port of src/game/world-scale.ts. Coordinates stay in simulation space;
## WORLD_SCALE is applied once by the scene parent, never by these helpers.

const WORLD_SCALE = 3
const STORE_LAYOUT_SCALE = 2
const STORE_ELEMENT_SCALE = 1.6
const STORE_PRODUCTION_FIXTURES = ProductionLayout.STORE_PRODUCTION_FIXTURES
static var STORE_OBSTACLES: Array = _build_obstacles()

static func _build_obstacles() -> Array:
	var base: Array = []
	for department_id in RetailLayout.RETAIL_DEPARTMENT_IDS:
		var department: Dictionary = RetailLayout.RETAIL_DEPARTMENTS[department_id]
		var quarter_turn: bool = fmod(absf(department.get("yaw", 0)), 180) == 90
		var displays: Array = RetailLayout.PANTRY_DISPLAY_POSITIONS if department_id == "pantry" else (RetailLayout.PRODUCE_DISPLAY_POSITIONS if department_id == "produce" else [department.display])
		for i in displays.size():
			base.append({"id": "fixture:retail-%s-%d" % [department_id, i + 1], "x": displays[i][0], "z": displays[i][2], "halfX": department.fixtureHalfExtents[1 if quarter_turn else 0], "halfZ": department.fixtureHalfExtents[0 if quarter_turn else 1]})
	for i in 3:
		base.append({"id": null if i == 0 else "fixture:checkout-%d" % (i + 1), "x": CheckoutLayout.CHECKOUT_LANES[i].counter[0], "z": CheckoutLayout.CHECKOUT_LANES[i].counter[2], "halfX": 2.25, "halfZ": 0.65})
	for fixture in STORE_PRODUCTION_FIXTURES.values():
		base.append({"id": fixture.obstacleId, "x": fixture.position[0] + fixture.localFootprint.centerX * STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE, "z": fixture.position[2] + fixture.localFootprint.centerZ * STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE, "halfX": fixture.localFootprint.halfX, "halfZ": fixture.localFootprint.halfZ})
	for wall in ProductionLayout.PRODUCTION_CUBICLE.walls:
		base.append({"id": wall.id, "x": wall.position[0], "z": wall.position[2], "halfX": wall.halfX * STORE_LAYOUT_SCALE / STORE_ELEMENT_SCALE, "halfZ": wall.halfZ * STORE_LAYOUT_SCALE / STORE_ELEMENT_SCALE})
	var station: Dictionary = WarehouseLayout.WAREHOUSE_RETURN_STATION
	base.append({"id": station.obstacleId, "x": station.position[0], "z": station.position[2], "halfX": station.footprint.halfX, "halfZ": station.footprint.halfZ})
	for fixture_id in StoreServiceLayout.STORE_SERVICE_FIXTURE_IDS:
		var fixture: Dictionary = StoreServiceLayout.STORE_SERVICE_FIXTURES[fixture_id]
		base.append({"id": fixture.obstacleId, "x": fixture.position[0], "z": fixture.position[2], "halfX": fixture.footprint.halfX, "halfZ": fixture.footprint.halfZ})
	base.append_array(FarmLayout.FARM_OBSTACLES)
	var result: Array = []
	for obstacle in base:
		result.append({"id": obstacle.get("id"), "x": obstacle.x * STORE_LAYOUT_SCALE, "z": obstacle.z * STORE_LAYOUT_SCALE, "halfX": obstacle.halfX * STORE_ELEMENT_SCALE, "halfZ": obstacle.halfZ * STORE_ELEMENT_SCALE})
	return result

static func scale_store_position(position: Array) -> Array:
	return [position[0] * STORE_LAYOUT_SCALE, position[1], position[2] * STORE_LAYOUT_SCALE]

static func scale_store_point(point: Array) -> Array:
	return [point[0] * STORE_LAYOUT_SCALE, point[1] * STORE_LAYOUT_SCALE]

static func store_segment_is_clear(start: Array, end: Array, padding_layout: float = 0.31) -> bool:
	var distance := JS.hypot(end[0] - start[0], end[1] - start[1])
	var steps := maxi(1, ceili(distance / 0.2))
	for step in steps + 1:
		var progress := float(step) / steps
		var point := [start[0] + (end[0] - start[0]) * progress, start[1] + (end[1] - start[1]) * progress]
		if overlaps_store_obstacle(scale_store_point(point), padding_layout * STORE_LAYOUT_SCALE): return false
	return true

static func store_obstacles_for_areas(areas: Array = []) -> Array:
	return STORE_OBSTACLES.filter(func(obstacle): return FixtureAvailability.fixture_available(obstacle.get("id"), areas))

static func overlaps_store_obstacle(point: Array, radius: float, areas: Array = []) -> bool:
	for obstacle in STORE_OBSTACLES:
		if FixtureAvailability.fixture_available(obstacle.get("id"), areas) and absf(point[0] - obstacle.x) < obstacle.halfX + radius and absf(point[1] - obstacle.z) < obstacle.halfZ + radius:
			return true
	return false
