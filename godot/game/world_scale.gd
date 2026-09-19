class_name WorldScale
extends RefCounted
## Port of src/game/world-scale.ts. Obstacles are Dictionaries
## { id (optional/null), x, z, halfX, halfZ }; STORE_OBSTACLES is in scaled
## simulation units. Cross-module: FixtureAvailability.fixture_available(id, areas)
## (must accept a null id: the first checkout counter has none).

## WORLD_SCALE preserves the current rendered size of every character.
const WORLD_SCALE = 3
const STORE_LAYOUT_SCALE = 2
const STORE_ELEMENT_SCALE = 1.6

## Re-export of ProductionLayout.STORE_PRODUCTION_FIXTURES.
const STORE_PRODUCTION_FIXTURES = ProductionLayout.STORE_PRODUCTION_FIXTURES

static func _production_obstacles() -> Array:
	var obstacles := []
	for fixture in STORE_PRODUCTION_FIXTURES.values():
		obstacles.append({
			"id": fixture.obstacleId,
			"x": fixture.position[0] + fixture.localFootprint.centerX * STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE,
			"z": fixture.position[2] + fixture.localFootprint.centerZ * STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE,
			"halfX": fixture.localFootprint.halfX,
			"halfZ": fixture.localFootprint.halfZ,
		})
	return obstacles

static func _production_cubicle_obstacles() -> Array:
	var obstacles := []
	for wall in ProductionLayout.PRODUCTION_CUBICLE.walls:
		obstacles.append({
			"id": wall.id,
			"x": wall.position[0],
			"z": wall.position[2],
			# BASE_STORE_OBSTACLES multiplies extents by the element scale. Convert
			# authored layout dimensions first so walls land on their visible panes.
			"halfX": wall.halfX * STORE_LAYOUT_SCALE / STORE_ELEMENT_SCALE,
			"halfZ": wall.halfZ * STORE_LAYOUT_SCALE / STORE_ELEMENT_SCALE,
		})
	return obstacles

static func _retail_obstacles() -> Array:
	var obstacles := []
	for department_id in RetailLayout.RETAIL_DEPARTMENT_IDS:
		var department: Dictionary = RetailLayout.RETAIL_DEPARTMENTS[department_id]
		var quarter_turn: bool = absi(JS.get_or(department, "yaw", 0)) % 180 == 90
		var displays: Array
		if department_id == "pantry": displays = RetailLayout.PANTRY_DISPLAY_POSITIONS
		elif department_id == "produce": displays = RetailLayout.PRODUCE_DISPLAY_POSITIONS
		else: displays = [department.display]
		for index in displays.size():
			var display: Array = displays[index]
			obstacles.append({
				"id": "fixture:retail-%s-%d" % [department_id, index + 1],
				"x": display[0],
				"z": display[2],
				"halfX": department.fixtureHalfExtents[1 if quarter_turn else 0],
				"halfZ": department.fixtureHalfExtents[0 if quarter_turn else 1],
			})
	return obstacles

static func _base_store_obstacles() -> Array:
	var lanes: Dictionary = CheckoutLayout.CHECKOUT_LANES
	var crate: Dictionary = WarehouseLayout.WAREHOUSE_RETURN_STATION
	var obstacles: Array = _retail_obstacles()
	obstacles.append({ "x": lanes[0].counter[0], "z": lanes[0].counter[2], "halfX": 2.25, "halfZ": 0.65 })
	obstacles.append({ "id": "fixture:checkout-2", "x": lanes[1].counter[0], "z": lanes[1].counter[2], "halfX": 2.25, "halfZ": 0.65 })
	obstacles.append({ "id": "fixture:checkout-3", "x": lanes[2].counter[0], "z": lanes[2].counter[2], "halfX": 2.25, "halfZ": 0.65 })
	obstacles.append_array(_production_obstacles())
	obstacles.append_array(_production_cubicle_obstacles())
	obstacles.append({
		"id": crate.obstacleId,
		"x": crate.position[0],
		"z": crate.position[2],
		"halfX": crate.footprint.halfX,
		"halfZ": crate.footprint.halfZ,
	})
	for fixture_id in StoreServiceLayout.STORE_SERVICE_FIXTURE_IDS:
		var fixture: Dictionary = StoreServiceLayout.STORE_SERVICE_FIXTURES[fixture_id]
		obstacles.append({
			"id": fixture.obstacleId,
			"x": fixture.position[0],
			"z": fixture.position[2],
			"halfX": fixture.footprint.halfX,
			"halfZ": fixture.footprint.halfZ,
		})
	obstacles.append_array(FarmLayout.FARM_OBSTACLES)
	return obstacles

static func _build_store_obstacles() -> Array:
	var scaled := []
	for obstacle in _base_store_obstacles():
		scaled.append({
			"id": obstacle.get("id"),
			"x": obstacle.x * STORE_LAYOUT_SCALE,
			"z": obstacle.z * STORE_LAYOUT_SCALE,
			"halfX": obstacle.halfX * STORE_ELEMENT_SCALE,
			"halfZ": obstacle.halfZ * STORE_ELEMENT_SCALE,
		})
	return scaled

static var STORE_OBSTACLES: Array = _build_store_obstacles()

static func scale_store_position(position: Array) -> Array:
	return [position[0] * STORE_LAYOUT_SCALE, position[1], position[2] * STORE_LAYOUT_SCALE]

static func scale_store_point(point: Array) -> Array:
	return [point[0] * STORE_LAYOUT_SCALE, point[1] * STORE_LAYOUT_SCALE]

## True when a straight walk between two layout points stays outside every
## padded fixture. Sampled every 0.2 layout units, which is finer than any
## fixture footprint or the navigation padding.
static func store_segment_is_clear(start: Array, end: Array, padding_layout: float = 0.31) -> bool:
	var distance := JS.hypot(end[0] - start[0], end[1] - start[1])
	var steps := maxi(1, JS.ceil(distance / 0.2))
	for step in steps + 1:
		var progress := float(step) / steps
		var point := [start[0] + (end[0] - start[0]) * progress, start[1] + (end[1] - start[1]) * progress]
		if overlaps_store_obstacle(scale_store_point(point), padding_layout * STORE_LAYOUT_SCALE): return false
	return true

static func store_obstacles_for_areas(areas: Array = []) -> Array:
	return JS.filter(STORE_OBSTACLES, func(obstacle): return FixtureAvailability.fixture_available(obstacle.get("id"), areas))

static func overlaps_store_obstacle(point: Array, radius: float, areas: Array = []) -> bool:
	for obstacle in STORE_OBSTACLES:
		if FixtureAvailability.fixture_available(obstacle.get("id"), areas) \
			and absf(point[0] - obstacle.x) < obstacle.halfX + radius \
			and absf(point[1] - obstacle.z) < obstacle.halfZ + radius:
			return true
	return false
