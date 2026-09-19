class_name PurchaseLayout
extends RefCounted
## Port of src/game/stations/purchase-layout.ts.
## Cross-module: MartCampaign.OPENING_PURCHASES (Array of { id, label,
## requires, baseCostMinor }) and FixtureAvailability.ALL_PURCHASED_AREAS.
## The only navigation dependency is the pure predicate
## NavMeshService.is_store_navigation_point; `place_marker` and
## `marker_spot_is_free` accept an injectable walkability Callable
## (point: [x, z]) -> bool so tests or the scene can substitute it.

## Clear front-of-store service space, away from checkout and pantry sockets.
const PURCHASE_POINT = [-3.8, 0.06, 4.8]

## PurchaseMarkerCorner: "lower-left" | "lower-right" | "upper-left" | "upper-right" | "authored"

## Element-to-layout factor: footprints are authored in element units.
const ELEMENT_TO_LAYOUT = WorldScale.STORE_ELEMENT_SCALE / WorldScale.STORE_LAYOUT_SCALE
## Marker centre to element corner, so the square clears the element by a hand.
const CORNER_GAP = (PurchaseMarker.PURCHASE_MARKER.halfSize + 0.14) * ELEMENT_TO_LAYOUT
## Marker centre to any socket the owner works from: the magnet plus a body.
const PURCHASE_MARKER_CLEARANCE = 1
## Farm markers stay in front of the wall's shadow line, like the beds do:
## the square's front edge, not just its centre, clears the line by 0.3.
static var FARM_MARKER_MAX_Z: float = FarmLayout.FARM_VISIBLE_FRONT_Z - 0.3 - PurchaseMarker.PURCHASE_MARKER.halfSize * ELEMENT_TO_LAYOUT
## A marker must stand inside the walls (store) or the fences (farm), a body away.
const STORE_MARKER_BOUNDS = { "minX": -10.9, "maxX": 10.9, "minZ": -8.2, "maxZ": 7.4 }
static var FARM_MARKER_BOUNDS: Dictionary = { "minX": -10.45, "maxX": 10.45, "minZ": -17.6, "maxZ": FARM_MARKER_MAX_Z }
## When a corner is taken, the marker slides along that edge towards the middle.
const CORNER_SLIDE_STEP = 0.38

## Footprint: { xmin, xmax, zmin, zmax, farm }
static func _obstacle_footprint(id: String) -> Variant:
	var obstacle = JS.find(WorldScale.STORE_OBSTACLES, func(candidate): return candidate.get("id") == id)
	if obstacle == null:
		push_error("purchase-layout: no obstacle %s" % id)
		return null
	var x: float = obstacle.x / WorldScale.STORE_LAYOUT_SCALE
	var z: float = obstacle.z / WorldScale.STORE_LAYOUT_SCALE
	var half_x: float = obstacle.halfX / WorldScale.STORE_LAYOUT_SCALE
	var half_z: float = obstacle.halfZ / WorldScale.STORE_LAYOUT_SCALE
	return { "xmin": x - half_x, "xmax": x + half_x, "zmin": z - half_z, "zmax": z + half_z, "farm": z < -9 }

static func _plot_footprint(id: String) -> Dictionary:
	var plot: Dictionary = JS.find(FarmLayout.FARM_PLOTS, func(candidate): return candidate.id == id)
	var half_x: float = FarmLayout.FARM_PLOT_FOOTPRINT.halfX * ELEMENT_TO_LAYOUT
	var half_z: float = FarmLayout.FARM_PLOT_FOOTPRINT.halfZ * ELEMENT_TO_LAYOUT
	return { "xmin": plot.position[0] - half_x, "xmax": plot.position[0] + half_x, "zmin": plot.position[2] - half_z, "zmax": plot.position[2] + half_z, "farm": true }

## The thing each purchase buys or improves; its marker sits at one of its
## corners. Values are ["obstacle", obstacleId] or ["plot", cropId], resolved
## lazily by `_purchase_element` (the TS map held thunks).
const PURCHASE_ELEMENTS = {
	"chicken-1": ["obstacle", "fixture:chicken-coop"],
	"chicken-1-tier-2": ["obstacle", "fixture:chicken-coop"],
	"chicken-1-tier-3": ["obstacle", "fixture:chicken-coop"],
	"chicken-2": ["obstacle", "fixture:chicken-coop-2"],
	"cow-1": ["obstacle", "fixture:cow-station"],
	"cow-1-tier-2": ["obstacle", "fixture:cow-station"],
	"cow-1-tier-3": ["obstacle", "fixture:cow-station"],
	"tomato-2": ["plot", "crop-tomato-2"],
	"tomato-3": ["plot", "crop-tomato-3"],
	"wheat-1": ["plot", "crop-wheat-1"],
	"corn-1": ["plot", "crop-corn-1"],
	"apple-1": ["plot", "crop-apple-1"],
	"orange-1": ["plot", "crop-orange-1"],
	"egg-display-1": ["obstacle", "fixture:retail-eggs-1"],
	"dairy-display-1": ["obstacle", "fixture:retail-dairy-1"],
	"coffee-supply-1": ["plot", "crop-coffee-1"],
	"preserves-supply-1": ["obstacle", "fixture:retail-preserves-1"],
	"flour-mill-1": ["obstacle", "fixture:flour-mill"],
	"bread-oven-1": ["obstacle", "fixture:bread-oven"],
	"cheese-maker-1": ["obstacle", "fixture:cheese-maker"],
	"juice-machine-1": ["obstacle", "fixture:juice-machine"],
	"corn-canner-1": ["obstacle", "fixture:corn-canner"],
}

static func _purchase_element(id: String) -> Variant:
	var element = PURCHASE_ELEMENTS.get(id)
	if element == null: return null
	return _obstacle_footprint(element[1]) if element[0] == "obstacle" else _plot_footprint(element[1])

## Purchases with no element of their own, and the fallback for an element
## whose four corners are all walled in or on a socket: measured spots on
## the farm apron, the store front and beside the rear door.
const AUTHORED_POSITIONS = {
	# Farmers have no element: their markers line the apron between the front
	# beds' corner markers and the fence, still in front of the wall's shadow.
	"farmer-1": [-8.8, -12.3],
	"farmer-2": [-6.1, -12.3],
	"farmer-3": [-1.4, -12.3],
	"player-2": [PURCHASE_POINT[0], PURCHASE_POINT[2]],
	"expansion-1": [5.2, -7.8],
	"chicken-1": [0.45, -12.6],
	"chicken-1-tier-2": [0.45, -12.6],
	"chicken-1-tier-3": [0.45, -12.6],
	"chicken-2": [8.8, -12.6],
	"cow-1": [5.85, -12.6],
	"cow-1-tier-2": [5.85, -12.6],
	"cow-1-tier-3": [5.85, -12.6],
	"tomato-2": [-6.3, -16.9],
	"tomato-3": [-3.6, -16.9],
	"wheat-1": [-3.6, -13.7],
	"corn-1": [-6.3, -13.7],
	"apple-1": [-9, -13.7],
	"orange-1": [7.2, -13.7],
	"egg-display-1": [-8.6, -1.75],
	"dairy-display-1": [-9.5, 4.3],
	"coffee-supply-1": [8.9, -12.5],
	"preserves-supply-1": [10.2, -2.8],
	"flour-mill-1": [-10.9, -5.2],
	"bread-oven-1": [-7.3, -5.9],
	"cheese-maker-1": [-6.4, -2.6],
	"juice-machine-1": [-5.4, -7.6],
	"corn-canner-1": [10.6, -5.6],
}

## Every spot the owner stands on to work: a marker may never sit on one.
## [{ id, point: [x, z] }, ...]
static var PURCHASE_WORK_SOCKETS: Array = _build_work_sockets()

static func _build_work_sockets() -> Array:
	var sockets := []
	for station in WorkstationLayout.WORKSTATIONS.values():
		sockets.append({ "id": "work:%s" % station.id, "point": [station.position[0], station.position[2]] })
	for id in RetailLayout.RETAIL_DEPARTMENT_IDS:
		var service: Array = RetailLayout.RETAIL_DEPARTMENTS[id].service
		sockets.append({ "id": "service:%s" % id, "point": [service[0], service[1]] })
	var rear_door: Dictionary = StorefrontLayout.STORE_REAR_DOOR
	sockets.append({ "id": "rear-door-inside", "point": [rear_door.insideApproach[0], rear_door.insideApproach[1]] })
	sockets.append({ "id": "rear-door-outside", "point": [rear_door.outsideApproach[0], rear_door.outsideApproach[1]] })
	sockets.append({ "id": "stockroom", "point": [WarehouseLayout.STOCKROOM_POINT[0], WarehouseLayout.STOCKROOM_POINT[1]] })
	sockets.append({ "id": "warehouse-return", "point": [WarehouseLayout.WAREHOUSE_RETURN_STATION.position[0], WarehouseLayout.WAREHOUSE_RETURN_STATION.position[2]] })
	sockets.append({ "id": "farm-barn", "point": [FarmLayout.FARM_BARN.workerPosition[0], FarmLayout.FARM_BARN.workerPosition[1]] })
	sockets.append({ "id": "farm-worker-home", "point": [FarmLayout.FARM_WORKER_HOME[0], FarmLayout.FARM_WORKER_HOME[1]] })
	for plot in FarmLayout.FARM_PLOTS:
		sockets.append({ "id": "crop:%s" % plot.id, "point": [plot.position[0], plot.position[2]] })
	for id in FarmLayout.FARM_ANIMAL_STATIONS:
		var station: Dictionary = FarmLayout.FARM_ANIMAL_STATIONS[id]
		sockets.append({ "id": "animal:%s" % id, "point": [station.workPosition[0], station.workPosition[2]] })
	for lane in CheckoutLayout.CHECKOUT_LANE_IDS:
		var layout: Dictionary = CheckoutLayout.CHECKOUT_LANES[lane]
		var register := RegisterLayout.register_pickup_position(lane)
		sockets.append({ "id": "checkout-%d:cashier" % (lane + 1), "point": [layout.cashierWork[0], layout.cashierWork[2]] })
		sockets.append({ "id": "checkout-%d:front" % (lane + 1), "point": [layout.customerFront[0], layout.customerFront[1]] })
		sockets.append({ "id": "checkout-%d:bag" % (lane + 1), "point": [layout.bagPickup[0], layout.bagPickup[1]] })
		sockets.append({ "id": "checkout-%d:register" % (lane + 1), "point": [register[0], register[2]] })
		for slot in [1, 2, 3]:
			sockets.append({ "id": "checkout-%d:queue-%d" % [lane + 1, slot], "point": CheckoutLayout.checkout_queue_position(slot, lane) })
	return sockets

const CORNERS = [
	# Screen order for the fixed camera at +x/+z: lower-left is min x, max z.
	{ "corner": "lower-left", "dx": -1, "dz": 1 },
	{ "corner": "lower-right", "dx": 1, "dz": 1 },
	{ "corner": "upper-left", "dx": -1, "dz": -1 },
	{ "corner": "upper-right", "dx": 1, "dz": -1 },
]

static func _walkable(point: Array, walkable: Callable) -> bool:
	if walkable.is_valid(): return walkable.call(point)
	return NavMeshService.is_store_navigation_point(point, FixtureAvailability.ALL_PURCHASED_AREAS)

static func marker_spot_is_free(point: Array, farm: bool, walkable: Callable = Callable()) -> bool:
	var bounds: Dictionary = FARM_MARKER_BOUNDS if farm else STORE_MARKER_BOUNDS
	if point[0] < bounds.minX or point[0] > bounds.maxX or point[1] < bounds.minZ or point[1] > bounds.maxZ: return false
	if not _walkable(point, walkable): return false
	if WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point(point), 0.32 * WorldScale.STORE_LAYOUT_SCALE, FixtureAvailability.ALL_PURCHASED_AREAS): return false
	return JS.every(PURCHASE_WORK_SOCKETS, func(socket): return JS.hypot(socket.point[0] - point[0], socket.point[1] - point[1]) >= PURCHASE_MARKER_CLEARANCE)

## The corner itself, then the same edge slid towards the element's middle:
## a pen wedged against its neighbour still gets its marker in front of its
## own left half instead of somewhere unrelated.
static func _corner_candidates(element: Dictionary, dx: int, dz: int) -> Array:
	var corner_x: float = (element.xmin if dx < 0 else element.xmax) + dx * CORNER_GAP
	var corner_z: float = (element.zmin if dz < 0 else element.zmax) + dz * CORNER_GAP
	var centre_x: float = (element.xmin + element.xmax) / 2
	var candidates := [[corner_x, corner_z]]
	var x := corner_x - dx * CORNER_SLIDE_STEP
	while (x <= centre_x) if dx < 0 else (x >= centre_x):
		candidates.append([x, corner_z])
		x -= dx * CORNER_SLIDE_STEP
	return candidates

## { position: [x, z], corner }
static func place_marker(id: String, walkable: Callable = Callable()) -> Dictionary:
	var element = _purchase_element(id)
	if element != null:
		for corner in CORNERS:
			var point = JS.find(_corner_candidates(element, corner.dx, corner.dz), func(candidate): return marker_spot_is_free(candidate, element.farm, walkable))
			if point != null: return { "position": [JS.round(point[0] * 1000) / 1000.0, JS.round(point[1] * 1000) / 1000.0], "corner": corner.corner }
	var authored = AUTHORED_POSITIONS.get(id)
	if authored == null:
		push_error("purchase-layout: no spot for %s" % id)
		return { "position": [0, 0], "corner": "authored" }
	return { "position": authored, "corner": "authored" }

## The pay marker of every purchase: a small square at the lower-left corner
## (as the fixed camera sees it) of the thing it buys, the first free corner
## clockwise when that one is walled in or on a work socket, and a measured
## spot for purchases with no element of their own. test_purchase_layout.gd
## checks every spot against the NavMesh, the obstacles and the sockets.
static var PURCHASE_MARKER_PLACEMENTS: Dictionary = _build_placements()

static func _build_placements() -> Dictionary:
	var placements := {}
	for purchase in MartCampaign.OPENING_PURCHASES:
		placements[purchase.id] = place_marker(purchase.id)
	return placements

## purchaseId → [x, 0.06, z]
static var PURCHASE_POSITIONS: Dictionary = _build_positions()

static func _build_positions() -> Dictionary:
	var positions := {}
	for purchase in MartCampaign.OPENING_PURCHASES:
		var position: Array = PURCHASE_MARKER_PLACEMENTS[purchase.id].position
		positions[purchase.id] = [position[0], 0.06, position[1]]
	return positions

static func purchase_interaction_id(id: String) -> String:
	return "purchase:" + id

static func is_purchase_interaction_id(id: String) -> bool:
	return id.begins_with("purchase:")

static func purchase_id_from_interaction(id: String) -> String:
	return id.substr("purchase:".length())
