class_name ProductionLayout
extends RefCounted
## Port of src/game/stations/production-layout.ts.
## Fixture keys: fixtureId, workstationId, machineId, obstacleId, label,
## processLabel, accent, position [x, y, z], yaw (optional),
## localFootprint { centerX, centerZ, halfX, halfZ } (local StoreElement
## coordinates), operatorWorkPoint [x, z] (authored layout units).

## Reach measured outwards from every side and rounded corner of a machine:
## the owner's own body only, so the machine works when touched.
const PRODUCTION_MAGNET_REACH = InteractionZone.CONTACT_MAGNET_REACH

## A compact, professional production room in the rear-left corner. Machine
## origins sit on their public/front edge; their solid bodies extend towards
## negative Z, matching the authored GLB orientation.
const STORE_PRODUCTION_FIXTURES = {
	"cornCanner": {
		"fixtureId": "cornCanner", "workstationId": "canner", "machineId": "corn-canner-1",
		"obstacleId": "fixture:corn-canner", "label": "ENLATADORA", "processLabel": "MAÍZ · CONSERVA",
		"accent": "#65833d", "position": [10, 0, -7.4],
		"localFootprint": { "centerX": 0, "centerZ": -0.55, "halfX": 0.6, "halfZ": 0.55 },
		"operatorWorkPoint": [9, -6.6],
	},
	"flourMill": {
		"fixtureId": "flourMill",
		"workstationId": "mill",
		"machineId": "flour-mill-1",
		"obstacleId": "fixture:flour-mill",
		"label": "MOLINO",
		"processLabel": "TRIGO · HARINA",
		"accent": "#c99a45",
		"position": [-10.5, 0, -7.35],
		"localFootprint": { "centerX": 0, "centerZ": -0.58, "halfX": 0.65, "halfZ": 0.58 },
		"operatorWorkPoint": [-9.65, -6.55],
	},
	"breadOven": {
		"fixtureId": "breadOven",
		"workstationId": "bakery",
		"machineId": "bread-oven-1",
		"obstacleId": "fixture:bread-oven",
		"label": "HORNO",
		"processLabel": "HARINA · PAN",
		"accent": "#c96d3e",
		"position": [-7.85, 0, -7.35],
		"localFootprint": { "centerX": 0, "centerZ": -0.55, "halfX": 0.76, "halfZ": 0.55 },
		"operatorWorkPoint": [-8.8, -6.55],
	},
	"cheeseMaker": {
		"fixtureId": "cheeseMaker",
		"workstationId": "cheese",
		"machineId": "cheese-maker-1",
		"obstacleId": "fixture:cheese-maker",
		"label": "QUESERÍA",
		"processLabel": "LECHE · QUESO",
		"accent": "#d8a92f",
		"position": [-7.25, 0, -3.85],
		"localFootprint": { "centerX": 0, "centerZ": -0.55, "halfX": 0.6, "halfZ": 0.55 },
		"operatorWorkPoint": [-8.7, -4],
	},
	"juiceMachine": {
		"fixtureId": "juiceMachine",
		"workstationId": "juice",
		"machineId": "juice-machine-1",
		"obstacleId": "fixture:juice-machine",
		"label": "ZUMOS",
		"processLabel": "NARANJA · ZUMO",
		"accent": "#df7540",
		"position": [-5.4, 0, -5.8],
		"yaw": 0,
		"localFootprint": { "centerX": 0, "centerZ": -0.55, "halfX": 0.6, "halfZ": 0.55 },
		"operatorWorkPoint": [-5.4, -4.4],
	},
}

const PRODUCTION_FIXTURE_IDS = ["cornCanner", "flourMill", "breadOven", "cheeseMaker", "juiceMachine"]
const PRODUCTION_WORKSTATION_IDS = ["mill", "bakery", "cheese", "juice", "canner"]

## machineId → [x, z] operator work point.
static var PRODUCTION_MACHINE_POINTS: Dictionary = _build_machine_points()

static func _build_machine_points() -> Dictionary:
	var points := {}
	for fixture_id in PRODUCTION_FIXTURE_IDS:
		var fixture: Dictionary = STORE_PRODUCTION_FIXTURES[fixture_id]
		points[fixture.machineId] = [fixture.operatorWorkPoint[0], fixture.operatorWorkPoint[1]]
	return points

static func is_production_workstation_id(id: String) -> bool:
	return PRODUCTION_WORKSTATION_IDS.has(id)

static func production_fixture_for_workstation(id: String) -> Dictionary:
	var fixture_id = JS.find(PRODUCTION_FIXTURE_IDS, func(candidate): return STORE_PRODUCTION_FIXTURES[candidate].workstationId == id)
	return STORE_PRODUCTION_FIXTURES[fixture_id]

## Complete rounded-rectangle interaction volume in scaled simulation units:
## { x, z, halfExtents, enterRadius, exitRadius }
static func production_machine_magnet(id: String, layout_scale: float, element_scale: float) -> Dictionary:
	var fixture := production_fixture_for_workstation(id)
	var footprint: Dictionary = fixture.localFootprint
	return {
		"x": fixture.position[0] * layout_scale + footprint.centerX * element_scale,
		"z": fixture.position[2] * layout_scale + footprint.centerZ * element_scale,
		"halfExtents": [
			footprint.halfX * element_scale,
			footprint.halfZ * element_scale,
		],
		"enterRadius": PRODUCTION_MAGNET_REACH.enter,
		"exitRadius": PRODUCTION_MAGNET_REACH.exit,
	}

static func _cubicle_wall(id: String, x: float, z: float, half_x: float, half_z: float) -> Dictionary:
	return {
		"id": "fixture:production-cubicle-%s" % id,
		"position": [x, 0, z],
		# Half extents in authored layout units, converted by each consumer.
		"halfX": half_x,
		"halfZ": half_z,
	}

static var PRODUCTION_CUBICLE: Dictionary = {
	"center": [-9, -5.9],
	"bounds": { "left": -11.5, "right": -6.5, "rear": -8.55, "front": -3.25 },
	"doorway": { "centerX": -9, "halfWidth": 1.15 },
	"walls": [
		_cubicle_wall("left", -11.5, -5.9, 0.07, 2.65),
		_cubicle_wall("right", -6.5, -5.9, 0.07, 2.65),
		_cubicle_wall("rear", -9, -8.55, 2.5, 0.07),
		_cubicle_wall("front-left", -10.825, -3.25, 0.675, 0.07),
		_cubicle_wall("front-right", -7.175, -3.25, 0.675, 0.07),
	],
}
