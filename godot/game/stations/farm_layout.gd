class_name FarmLayout
extends RefCounted
## Port of src/game/stations/farm-layout.ts.
##
## The storefront sits on positive Z. The estate is intentionally beyond the
## rear wall on negative Z, reached directly through the rear service door.
## All values use the same unscaled layout coordinates consumed by navigation.
## Plot keys: id, productId, position [x, y, z], accent. Obstacle keys:
## id (optional), x, z, halfX, halfZ.

const FARM_SERVICE_LANE_X = 12.15
const FARM_ELEMENT_TO_LAYOUT_RATIO = 0.8
const FARM_FRONT_FENCE_Z = -10.575
const FARM_SIDE_FENCE_X = 10.6
const REAR_DOOR_CLEAR_HALF_WIDTH = StorefrontLayout.STORE_REAR_DOOR.door.outerPostOffset - StorefrontLayout.STORE_REAR_DOOR.door.postWidth / 2
const FARM_GATE_LEFT_POST_X = StorefrontLayout.STORE_REAR_DOOR.x - REAR_DOOR_CLEAR_HALF_WIDTH
const FARM_GATE_RIGHT_POST_X = StorefrontLayout.STORE_REAR_DOOR.x + REAR_DOOR_CLEAR_HALF_WIDTH
const FARM_LEFT_EDGE_X = -FARM_SIDE_FENCE_X
const STORE_REAR_DOOR_FARM_FACE_Z = StorefrontLayout.STORE_REAR_DOOR.z - StorefrontLayout.STORE_REAR_DOOR.door.frameDepth / 2
const STORE_REAR_WALL_OUTER_Z = StorefrontLayout.STORE_REAR_DOOR.wallCenterZ - StorefrontLayout.STORE_REAR_DOOR.wallDepth / 2
const ACCESS_CORRIDOR_FENCE_CENTER_Z = (FARM_FRONT_FENCE_Z + STORE_REAR_DOOR_FARM_FACE_Z) / 2
static var ACCESS_CORRIDOR_FENCE_HALF_Z: float = absf(FARM_FRONT_FENCE_Z - STORE_REAR_DOOR_FARM_FACE_Z) / 2 / FARM_ELEMENT_TO_LAYOUT_RATIO
const PERIMETER_WALL_FENCE_CENTER_Z = (FARM_FRONT_FENCE_Z + STORE_REAR_WALL_OUTER_Z) / 2
static var PERIMETER_WALL_FENCE_HALF_Z: float = absf(FARM_FRONT_FENCE_Z - STORE_REAR_WALL_OUTER_Z) / 2 / FARM_ELEMENT_TO_LAYOUT_RATIO

## One source for the visible gate, its physical solids and both approaches.
static var FARM_GATE: Dictionary = {
	"center": [StorefrontLayout.STORE_REAR_DOOR.x, 0, FARM_FRONT_FENCE_Z],
	"frontPost": [FARM_GATE_LEFT_POST_X, 0, FARM_FRONT_FENCE_Z],
	"innerPost": [FARM_GATE_RIGHT_POST_X, 0, FARM_FRONT_FENCE_Z],
	# The open leaf has the same rendered length as the widened storefront door
	# and starts flush behind the inner hinge post.
	"openLeaf": { "center": [FARM_GATE_RIGHT_POST_X, 0, FARM_FRONT_FENCE_Z - REAR_DOOR_CLEAR_HALF_WIDTH], "halfX": 0.07, "halfZ": REAR_DOOR_CLEAR_HALF_WIDTH / FARM_ELEMENT_TO_LAYOUT_RATIO, "terminalPostDepth": 0.09 },
	"rightFence": { "center": [FARM_SIDE_FENCE_X, 0, -14.15], "halfX": 0.07, "halfZ": 4.46875 },
	"leftFrontFence": { "center": [(FARM_LEFT_EDGE_X + FARM_GATE_LEFT_POST_X) / 2, 0, FARM_FRONT_FENCE_Z], "halfX": (FARM_GATE_LEFT_POST_X - FARM_LEFT_EDGE_X) / 2 / FARM_ELEMENT_TO_LAYOUT_RATIO, "halfZ": 0.07 },
	"rightFrontFence": { "center": [(FARM_GATE_RIGHT_POST_X + FARM_SIDE_FENCE_X) / 2, 0, FARM_FRONT_FENCE_Z], "halfX": (FARM_SIDE_FENCE_X - FARM_GATE_RIGHT_POST_X) / 2 / FARM_ELEMENT_TO_LAYOUT_RATIO, "halfZ": 0.07 },
	# These two rails form a direct chute from the clear edges of the rear door
	# to the matching gate posts. They prevent turning into either transverse
	# passage before entering the estate. Authored half extents account for
	# StoreElement's 1.6 render scale versus the 2.0 navigation layout scale.
	"accessCorridorFences": [
		{ "side": -1, "center": [FARM_GATE_LEFT_POST_X, 0, ACCESS_CORRIDOR_FENCE_CENTER_Z], "halfX": 0.07, "halfZ": ACCESS_CORRIDOR_FENCE_HALF_Z },
		{ "side": 1, "center": [FARM_GATE_RIGHT_POST_X, 0, ACCESS_CORRIDOR_FENCE_CENTER_Z], "halfX": 0.07, "halfZ": ACCESS_CORRIDOR_FENCE_HALF_Z },
	],
	# Keep the transverse pockets closed at their outer ends as a secondary
	# safeguard. The access fences above are the ones that stop a turn made
	# immediately after leaving the rear door.
	"perimeterWallFences": [
		{ "side": -1, "center": [-FARM_SIDE_FENCE_X, 0, PERIMETER_WALL_FENCE_CENTER_Z], "halfX": 0.07, "halfZ": PERIMETER_WALL_FENCE_HALF_Z },
		{ "side": 1, "center": [FARM_SIDE_FENCE_X, 0, PERIMETER_WALL_FENCE_CENTER_Z], "halfX": 0.07, "halfZ": PERIMETER_WALL_FENCE_HALF_Z },
	],
	"exteriorApproach": [StorefrontLayout.STORE_REAR_DOOR.outsideApproach[0], -9.35],
	# Recast's first complete cell beyond the posts. Using the geometric fence
	# line itself makes a capsule chase an unreachable projection after entry.
	"interiorApproach": [7.5, -11.55],
	"postHalfSize": 0.11,
}

## Center of the visible terminal post, kept fully inside the leaf collider. [x, z]
static func farm_gate_open_leaf_terminal_post(layout_scale: float, element_scale: float) -> Array:
	var safe_layout_scale := maxf(JS.EPSILON, layout_scale)
	var element_to_layout := maxf(0.0, element_scale) / safe_layout_scale
	var direction_z := JS.sign_of(FARM_GATE.openLeaf.center[2] - FARM_GATE.innerPost[2])
	if direction_z == 0: direction_z = -1
	return [
		FARM_GATE.openLeaf.center[0],
		FARM_GATE.openLeaf.center[2] + direction_z * (FARM_GATE.openLeaf.halfZ - FARM_GATE.openLeaf.terminalPostDepth / 2) * element_to_layout,
	]

static var FARM_FIELD: Dictionary = {
	"center": [0, 0, -14.15],
	"size": [21.2, 0, 7.15],
	# Interior arrival remains aligned with the centre of the visible opening.
	"entrance": [FARM_GATE.interiorApproach[0], 0, FARM_GATE.interiorApproach[1]],
	"serviceLaneX": FARM_SERVICE_LANE_X,
}

## The rear wall (STOREFRONT_LAYOUT.wallHeight, rendered unscaled in height by
## the building group, which scales only horizontally by the layout scale 2)
## hides a strip of farm ground from the fixed camera. Nothing the owner has
## to see or use may sit in it: it is the walking corridor between the gate
## and the first row, and the farm proper starts at FARM_CORRIDOR_BACK_Z.
const BUILDING_LAYOUT_SCALE = 2
static var FARM_WALL_SHADOW_DEPTH: float = OverviewCamera.wall_ground_shadow_depth(StorefrontLayout.STOREFRONT_LAYOUT.wallHeight) / BUILDING_LAYOUT_SCALE
static var FARM_VISIBLE_FRONT_Z: float = StorefrontLayout.STORE_REAR_DOOR.wallCenterZ - FARM_WALL_SHADOW_DEPTH
const FARM_CORRIDOR_BACK_Z = -13.2

## Farmers wait here between errands: on the visible corridor, off every ring.
const FARM_WORKER_HOME = [3.15, -12.5]

## Footprint occupied by the retired facade farm in schema-v4 saves created
## before the estate moved behind the building. It covers all four old beds,
## both animal stations and their immediate work apron, but not the storefront
## entrance itself. Persisted workers and remaining route points use this only
## as a migration marker; it never participates in current navigation.
const RETIRED_FRONT_FARM_BOUNDS = {
	"minX": -10.8,
	"maxX": -0.6,
	"minZ": 8.8,
	"maxZ": 13,
}

static func is_retired_front_farm_point(point: Array) -> bool:
	return point[0] >= RETIRED_FRONT_FARM_BOUNDS.minX \
		and point[0] <= RETIRED_FRONT_FARM_BOUNDS.maxX \
		and point[1] >= RETIRED_FRONT_FARM_BOUNDS.minZ \
		and point[1] <= RETIRED_FRONT_FARM_BOUNDS.maxZ

## Raised bed timbers, in local element units (the 1.92 × 1.18 planter). Beds
## stay traversable, so the harvest magnet is the bed's own footprint: the
## owner harvests while standing on or brushing the planter, never from the
## path beside it.
const FARM_PLOT_FOOTPRINT = { "halfX": 0.96, "halfZ": 0.59 }

const FARM_HARVEST_SENSOR = {
	"dwellMs": 35,
	"repeatEveryMs": 220,
	"exitGraceMs": 90,
}

static func scaled_farm_harvest_sensor(element_scale: float) -> Dictionary:
	return JS.spread(FARM_HARVEST_SENSOR, {
		"halfExtents": [FARM_PLOT_FOOTPRINT.halfX * element_scale, FARM_PLOT_FOOTPRINT.halfZ * element_scale],
		"enterRadius": InteractionZone.CONTACT_MAGNET_REACH.enter,
		"exitRadius": InteractionZone.CONTACT_MAGNET_REACH.exit,
	})

## Two rows of beds, every 2.7 layout units in x. The front row (apple, corn,
## wheat, the orange tree and the coffee bushes) sits as close to the store as
## the corridor rule allows: its timbers end at z −13.23, just past
## FARM_CORRIDOR_BACK_Z. The three tomato beds form the back row left of the
## barn, against the rear fence and aligned with the front columns, so the
## middle corridor between the rows (z −14.17 … −16.43) is 2.26 wide and can
## be walked without brushing a harvest magnet. The coffee bed closes the
## right side where the compost bin stood, by the gate and in front of the
## second chicken pen. It sits behind the tip of the open gate leaf so both
## actors and its timbers clear the gate, with its east edge at the fence.
const FARM_FRONT_BED_ROW_Z = -13.7
const FARM_REAR_BED_ROW_Z = -16.9
static var FARM_PLOTS = [
	{ "id": "crop-tomato-1", "productId": "tomatoes", "position": [-9, 0, FARM_REAR_BED_ROW_Z], "accent": "#e34f3f" },
	{ "id": "crop-tomato-2", "productId": "tomatoes", "position": [-6.3, 0, FARM_REAR_BED_ROW_Z], "accent": "#ef6a4b" },
	{ "id": "crop-tomato-3", "productId": "tomatoes", "position": [-3.6, 0, FARM_REAR_BED_ROW_Z], "accent": "#e34f3f" },
	{ "id": "crop-wheat-1", "productId": "wheat", "position": [-3.6, 0, FARM_FRONT_BED_ROW_Z], "accent": "#e9b83f" },
	{ "id": "crop-corn-1", "productId": "corn", "position": [-6.3, 0, FARM_FRONT_BED_ROW_Z], "accent": "#f0c438" },
	{ "id": "crop-orange-1", "productId": "oranges", "position": [7.2, 0, FARM_FRONT_BED_ROW_Z], "accent": "#D58236" },
	{ "id": "crop-apple-1", "productId": "apples", "position": [-9, 0, FARM_FRONT_BED_ROW_Z], "accent": "#c8362f" },
	{ "id": "crop-coffee-1", "productId": "coffee", "position": [9.82, 0, -14.85], "accent": "#c53b2f" },
]

## The barn in the middle of the back row is the farm's intake: whatever is
## dropped there is in the warehouse at once, so farmers shuttle bed → barn →
## bed without crossing the store, the feeder draws feed from it, and the
## owner empties a basket by touching it, exactly like the return crate.
## Footprint in element units, like every farm obstacle.
const FARM_BARN = {
	"interactionId": "farmBarn",
	"obstacleId": "fixture:farm-barn",
	"label": "Granero: entregar la cosecha al almacén",
	"position": [0, 0, -16.9],
	"footprint": { "halfX": 1.5, "halfZ": 0.85 },
	# Walkable point on the middle corridor, in front of the open doors.
	"workerPosition": [0, -15.4],
}

## Solid footprint of each paddock, in authored layout units; shared by the
## navigation obstacles and by the interaction magnet that wraps them.
const FARM_ANIMAL_FOOTPRINTS = {
	"chicken": { "halfX": 1.49, "halfZ": 1.09 },
	"chicken2": { "halfX": 1.49, "halfZ": 1.09 },
	"cow": { "halfX": 1.79, "halfZ": 1.24 },
}

## The pen itself is the magnet: its box is the same solid footprint the
## collider and the NavMesh use (element scale, not layout scale), and the
## reach is only the owner's body, so walking past the pen does nothing and
## touching it from any side works. Returns { x, z, halfExtents, enterRadius, exitRadius }.
static func farm_animal_magnet(id: String, layout_scale: float, element_scale: float) -> Dictionary:
	var station: Dictionary = FARM_ANIMAL_STATIONS[id]
	var footprint: Dictionary = FARM_ANIMAL_FOOTPRINTS[id]
	return {
		"x": station.position[0] * layout_scale,
		"z": station.position[2] * layout_scale,
		"halfExtents": [footprint.halfX * element_scale, footprint.halfZ * element_scale],
		"enterRadius": InteractionZone.CONTACT_MAGNET_REACH.enter,
		"exitRadius": InteractionZone.CONTACT_MAGNET_REACH.exit,
	}

## Pens on the back row right of the barn, against the rear fence, in the
## order chicken · cow · chicken, worked from the middle corridor.
const FARM_ANIMAL_STATIONS = {
	"chicken": { "position": [2.8, 0, -16.75], "workPosition": [2.8, 0, -15.15], "facing": PI },
	"chicken2": { "position": [9, 0, -16.75], "workPosition": [9, 0, -15.2], "facing": PI },
	"cow": { "position": [5.9, 0, -16.65], "workPosition": [5.9, 0, -15.05], "facing": PI },
}

static var FARM_ACCESS_WAYPOINTS: Array = [
	[StorefrontLayout.STORE_REAR_DOOR.insideApproach[0], StorefrontLayout.STORE_REAR_DOOR.insideApproach[1]],
	[StorefrontLayout.STORE_REAR_DOOR.outsideApproach[0], StorefrontLayout.STORE_REAR_DOOR.outsideApproach[1]],
	[FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]],
]

## A shared, obstacle-free spine inside the estate. Fallback employee routes
## use this corridor in both directions while Recast is still warming up, so
## a diagonal from the gate can never cut through a reserved animal paddock.
const FARM_INTERIOR_WAYPOINTS = {
	"entranceApron": [7.7, -12.5],
	"cropJunction": [-2, -12.5],
	"southCropJunction": [-2, -15.1],
	"coffeeApproach": [8.3, -14.85],
}

static func _same_farm_point(a: Array, b: Array) -> bool:
	return JS.hypot(a[0] - b[0], a[1] - b[1]) <= 0.08

static func _compact_farm_route(start: Array, route: Array) -> Array:
	var previous: Array = start
	var points := []
	for point in route:
		if _same_farm_point(previous, point): continue
		var next := [point[0], point[1]]
		points.append(next)
		previous = next
	return points

## Navigation obstacles are rendered at STORE_ELEMENT_SCALE (1.6) while route
## coordinates are consumed at STORE_LAYOUT_SCALE (2). Keep the same 31 cm
## actor clearance as the navmesh fallback checks before accepting a shortcut.
static func _segment_hits_farm_obstacle(start: Array, destination: Array, obstacle: Dictionary) -> bool:
	var half_x: float = obstacle.halfX * FARM_ELEMENT_TO_LAYOUT_RATIO + 0.31
	var half_z: float = obstacle.halfZ * FARM_ELEMENT_TO_LAYOUT_RATIO + 0.31
	var delta_x: float = destination[0] - start[0]
	var delta_z: float = destination[1] - start[1]
	var minimum := 0.0
	var maximum := 1.0
	for axis in [
		[start[0], delta_x, obstacle.x, half_x],
		[start[1], delta_z, obstacle.z, half_z],
	]:
		var origin: float = axis[0]
		var delta: float = axis[1]
		var center: float = axis[2]
		var half: float = axis[3]
		var lower := center - half
		var upper := center + half
		if absf(delta) < 1e-8:
			if origin < lower or origin > upper: return false
			continue
		var first := (lower - origin) / delta
		var second := (upper - origin) / delta
		minimum = maxf(minimum, minf(first, second))
		maximum = minf(maximum, maxf(first, second))
		if minimum > maximum: return false
	return true

static func _farm_segment_is_obstacle_free(start: Array, destination: Array) -> bool:
	for obstacle in FARM_OBSTACLES:
		if _segment_hits_farm_obstacle(start, destination, obstacle): return false
	return true

static func _farm_corridor_from_apron(destination: Array) -> Array:
	var entrance := [FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]]
	if _same_farm_point(destination, entrance): return []

	var route := [[FARM_INTERIOR_WAYPOINTS.entranceApron[0], FARM_INTERIOR_WAYPOINTS.entranceApron[1]]]
	if destination[0] <= 0:
		route.append([FARM_INTERIOR_WAYPOINTS.cropJunction[0], FARM_INTERIOR_WAYPOINTS.cropJunction[1]])
		if destination[1] < -14: route.append([FARM_INTERIOR_WAYPOINTS.southCropJunction[0], FARM_INTERIOR_WAYPOINTS.southCropJunction[1]])
	if destination[0] > FARM_GATE.openLeaf.center[0]: route.append([FARM_INTERIOR_WAYPOINTS.coffeeApproach[0], FARM_INTERIOR_WAYPOINTS.coffeeApproach[1]])
	route.append([destination[0], destination[1]])
	return route

## Route after reaching the open farm gate; the gate itself is not repeated.
static func farm_interior_route_from_entrance(destination: Array) -> Array:
	var entrance := [FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]]
	return _compact_farm_route(entrance, _farm_corridor_from_apron(destination))

## Route from an estate destination back through the open farm gate.
static func farm_interior_route_to_entrance(start: Array) -> Array:
	var entrance := [FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]]
	if _same_farm_point(start, entrance): return []
	var reversed := _farm_corridor_from_apron(start)
	reversed.reverse()
	reversed.append(entrance)
	return _compact_farm_route(start, reversed)

## Obstacle-safe fallback between two destinations already inside the farm.
static func farm_interior_route_between(start: Array, destination: Array) -> Array:
	if _same_farm_point(start, destination): return []
	var entrance := [FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]]
	var nodes: Array = []
	for point in [start, destination, entrance] + FARM_INTERIOR_WAYPOINTS.values():
		if not JS.some(nodes, func(candidate): return _same_farm_point(candidate, point)): nodes.append(point)
	var destination_index := JS.find_index(nodes, func(point): return _same_farm_point(point, destination))
	var distances: Array = []
	var previous: Array = []
	var visited: Array = []
	for _node in nodes:
		distances.append(INF)
		previous.append(-1)
		visited.append(false)
	distances[0] = 0.0

	for _step in nodes.size():
		var current := -1
		for index in nodes.size():
			if not visited[index] and (current < 0 or distances[index] < distances[current]): current = index
		if current < 0 or not is_finite(distances[current]): break
		if current == destination_index: break
		visited[current] = true

		for index in nodes.size():
			var candidate: Array = nodes[index]
			if visited[index] or index == current or not _farm_segment_is_obstacle_free(nodes[current], candidate): continue
			var distance: float = distances[current] + JS.hypot(nodes[current][0] - candidate[0], nodes[current][1] - candidate[1])
			if distance + 1e-8 < distances[index]:
				distances[index] = distance
				previous[index] = current

	if destination_index >= 0 and is_finite(distances[destination_index]):
		var shortest: Array = []
		var index := destination_index
		while index > 0:
			shortest.append(nodes[index])
			if previous[index] < 0: break
			index = previous[index]
		shortest.reverse()
		var last = JS.at(shortest, -1)
		if last != null and _same_farm_point(last, destination):
			return _compact_farm_route(start, shortest)

	# Defensive fallback for an unforeseen saved position outside the visibility
	# graph. Normal farm stations always resolve through the path above.
	return _compact_farm_route(start, [entrance] + farm_interior_route_from_entrance(destination))

## Permanent props, reserved paddocks and the perimeter fence participate in
## both navigation and physics. Crop beds deliberately stay traversable: the
## harvest loop is a walk-through magnet, not a stop-at-the-edge interaction.
static var FARM_OBSTACLES: Array = _build_farm_obstacles()

static func _fence_obstacle(fence: Dictionary) -> Dictionary:
	return {
		"x": fence.center[0],
		"z": fence.center[2],
		"halfX": fence.halfX,
		"halfZ": fence.halfZ,
	}

static func _build_farm_obstacles() -> Array:
	var obstacles := [
		{ "id": FARM_BARN.obstacleId, "x": FARM_BARN.position[0], "z": FARM_BARN.position[2], "halfX": FARM_BARN.footprint.halfX, "halfZ": FARM_BARN.footprint.halfZ },
		{ "id": "fixture:chicken-coop", "x": FARM_ANIMAL_STATIONS.chicken.position[0], "z": FARM_ANIMAL_STATIONS.chicken.position[2], "halfX": 1.49, "halfZ": 1.09 },
		{ "id": "fixture:chicken-coop-2", "x": FARM_ANIMAL_STATIONS.chicken2.position[0], "z": FARM_ANIMAL_STATIONS.chicken2.position[2], "halfX": 1.49, "halfZ": 1.09 },
		{ "id": "fixture:cow-station", "x": FARM_ANIMAL_STATIONS.cow.position[0], "z": FARM_ANIMAL_STATIONS.cow.position[2], "halfX": 1.79, "halfZ": 1.24 },
		{ "x": 0, "z": -17.725, "halfX": 13.25, "halfZ": 0.07 },
		{ "x": FARM_GATE.leftFrontFence.center[0], "z": FARM_GATE.leftFrontFence.center[2], "halfX": FARM_GATE.leftFrontFence.halfX, "halfZ": FARM_GATE.leftFrontFence.halfZ },
		{ "x": FARM_GATE.rightFrontFence.center[0], "z": FARM_GATE.rightFrontFence.center[2], "halfX": FARM_GATE.rightFrontFence.halfX, "halfZ": FARM_GATE.rightFrontFence.halfZ },
		{ "x": -FARM_SIDE_FENCE_X, "z": FARM_FIELD.center[2], "halfX": 0.07, "halfZ": 4.47 },
		{ "x": FARM_GATE.rightFence.center[0], "z": FARM_GATE.rightFence.center[2], "halfX": FARM_GATE.rightFence.halfX, "halfZ": FARM_GATE.rightFence.halfZ },
	]
	for fence in FARM_GATE.accessCorridorFences: obstacles.append(_fence_obstacle(fence))
	for fence in FARM_GATE.perimeterWallFences: obstacles.append(_fence_obstacle(fence))
	obstacles.append({ "x": FARM_GATE.frontPost[0], "z": FARM_GATE.frontPost[2], "halfX": FARM_GATE.postHalfSize, "halfZ": FARM_GATE.postHalfSize })
	obstacles.append({ "x": FARM_GATE.innerPost[0], "z": FARM_GATE.innerPost[2], "halfX": FARM_GATE.postHalfSize, "halfZ": FARM_GATE.postHalfSize })
	# The open gate leaf is folded against this east-perimeter section.
	obstacles.append({ "x": FARM_GATE.openLeaf.center[0], "z": FARM_GATE.openLeaf.center[2], "halfX": FARM_GATE.openLeaf.halfX, "halfZ": FARM_GATE.openLeaf.halfZ })
	return obstacles

static var FARM_PLOT_BY_ID: Dictionary = _build_plot_index()

static func _build_plot_index() -> Dictionary:
	var index := {}
	for plot in FARM_PLOTS: index[plot.id] = plot
	return index

## Plot Dictionary or null.
static func farm_plot_by_id(id: String) -> Variant:
	return FARM_PLOT_BY_ID.get(id)

## "farm:<cropId>" or null.
static func farm_interaction_id(crop_id: String) -> Variant:
	return "farm:" + crop_id if FARM_PLOT_BY_ID.has(crop_id) else null

## Crop id or null.
static func crop_id_from_farm_interaction(id: String) -> Variant:
	if not id.begins_with("farm:"): return null
	var crop_id := id.substr(5)
	return crop_id if FARM_PLOT_BY_ID.has(crop_id) else null

static func is_farm_interaction_id(id: String) -> bool:
	return crop_id_from_farm_interaction(id) != null
