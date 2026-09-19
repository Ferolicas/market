class_name StorefrontLayout
extends RefCounted
## Port of src/game/stations/storefront-layout.ts. Coordinates are in the
## unscaled store layout; positions stay `[x, y, z]` Arrays like the TS tables.

const STOREFRONT_LAYOUT = {
	"z": 7.8,
	"wallHeight": 5.6,
	"door": {
		"leafWidth": 1.68,
		"leafHeight": 5.4,
		"leafDepth": 0.065,
		"closedCenterOffset": 0.86,
		"openTravel": 1.84,
		"outerPostX": 1.82,
		"postWidth": 0.1,
		"frameDepth": 0.14,
	},
	# One rectangular approach volume shared by the player interaction layer
	# and every simulated actor. The previous player-only circle reached barely
	# half of the framed opening, so approaching either leaf did not open it.
	"sensor": {
		"centerX": 0,
		"centerZ": 8.5,
		"actorHalfWidth": 2.35,
		"actorHalfDepth": 2.3,
		"enterMargin": 0.08,
		"exitMargin": 0.24,
	},
}

## Rear service entrance shared by the building renderer, physics, navigation
## and fallback employee routes. Coordinates are in the unscaled store layout.
##
## The doorway is aligned with the estate gate at x=7.5. Keeping the complete
## opening here prevents the former failure mode where a decorative opening
## existed while the rear-wall collider and navigation band stayed solid.
const STORE_REAR_DOOR = {
	"x": 7.5,
	"z": -8.55,
	"wallCenterZ": -8.55,
	"wallHalfWidth": 11.5,
	"wallDepth": 0.32,
	"insideApproach": [7.5, -6.9],
	"outsideApproach": [7.5, -9.35],
	# Pre-Recast fallback corridor from the sales floor to the rear door: the
	# full-height north–south lane at x ≈ 3.1, west of the drinks display
	# (x ≥ 3.71, z ≤ −2.16); it clears the counters too and turns east only
	# past the display.
	"interiorCorridor": [
		[3.1, 0.45],
		[3.1, -4.6],
		[6.8, -6.35],
		[7.5, -6.9],
	],
	# The backroom rack is authored here as well because its former x=8.65
	# footprint invaded the new passage after navigation clearance was added.
	"adjacentRackPosition": [9.65, 0, -7.85],
	"door": {
		"leafWidth": STOREFRONT_LAYOUT.door.leafWidth,
		"leafHeight": STOREFRONT_LAYOUT.door.leafHeight,
		"leafDepth": STOREFRONT_LAYOUT.door.leafDepth,
		"closedCenterOffset": STOREFRONT_LAYOUT.door.closedCenterOffset,
		"openTravel": STOREFRONT_LAYOUT.door.openTravel,
		"outerPostOffset": STOREFRONT_LAYOUT.door.outerPostX,
		"postWidth": STOREFRONT_LAYOUT.door.postWidth,
		"frameDepth": STOREFRONT_LAYOUT.door.frameDepth,
	},
	"sensor": {
		"enterRadius": 2.35,
		"exitRadius": 2.65,
		"actorHalfWidth": STOREFRONT_LAYOUT.sensor.actorHalfWidth,
		"actorHalfDepth": STOREFRONT_LAYOUT.sensor.actorHalfDepth,
	},
	"motion": {
		"openMs": 310,
		"closeMs": 360,
		"holdOpenMs": 760,
	},
}

## RearDoorMotionState: { progress, emptyForMs }
const CLOSED_REAR_DOOR_MOTION = {
	"progress": 0,
	"emptyForMs": 0,
}

static func storefront_door_progress(progress: Variant) -> float:
	return maxf(0.0, minf(1.0, float(progress) if JS.is_finite_number(progress) else 0.0))

static func storefront_door_leaf_center(side: int, progress: float) -> float:
	var door: Dictionary = STOREFRONT_LAYOUT.door
	return side * (door.closedCenterOffset + storefront_door_progress(progress) * door.openTravel)

static func storefront_door_clear_width(progress: float) -> float:
	var door: Dictionary = STOREFRONT_LAYOUT.door
	return maxf(0.0, absf(storefront_door_leaf_center(1, progress)) * 2 - door.leafWidth)

## True from either side and across the complete storefront access.
static func storefront_door_actor_present(point: Array) -> bool:
	var sensor: Dictionary = STOREFRONT_LAYOUT.sensor
	var epsilon := 1e-9
	return absf(point[0] - sensor.centerX) <= sensor.actorHalfWidth + epsilon \
		and absf(point[1] - sensor.centerZ) <= sensor.actorHalfDepth + epsilon

static func rear_door_leaf_center(side: int, progress: float) -> float:
	var door: Dictionary = STORE_REAR_DOOR.door
	return STORE_REAR_DOOR.x + side * (door.closedCenterOffset + storefront_door_progress(progress) * door.openTravel)

static func rear_door_clear_width(progress: float) -> float:
	var door: Dictionary = STORE_REAR_DOOR.door
	return maxf(0.0, absf(rear_door_leaf_center(1, progress) - rear_door_leaf_center(-1, progress)) - door.leafWidth)

## Solid rear-wall pieces on either side of the authored doorway: [{ centerX, width }, ...]
static func rear_door_wall_segments() -> Array:
	var opening_half_width: float = STORE_REAR_DOOR.door.outerPostOffset + STORE_REAR_DOOR.door.postWidth / 2
	var left_edge: float = -STORE_REAR_DOOR.wallHalfWidth
	var right_edge: float = STORE_REAR_DOOR.wallHalfWidth
	var opening_left: float = STORE_REAR_DOOR.x - opening_half_width
	var opening_right: float = STORE_REAR_DOOR.x + opening_half_width
	return [
		{ "centerX": (left_edge + opening_left) / 2, "width": opening_left - left_edge },
		{ "centerX": (opening_right + right_edge) / 2, "width": right_edge - opening_right },
	]

## Decorative inner panels constrained to the same solid wall segments.
static func rear_door_wall_panels() -> Array:
	var right_wall: Dictionary = rear_door_wall_segments()[1]
	return [
		{ "centerX": -7.4, "width": 3.3 },
		{ "centerX": -3.7, "width": 3.3 },
		{ "centerX": 0, "width": 3.3 },
		{ "centerX": 3.7, "width": 3.3 },
		{ "centerX": right_wall.centerX, "width": right_wall.width - 0.36 },
	]

static func rear_door_actor_present(point: Array) -> bool:
	return absf(point[0] - STORE_REAR_DOOR.x) <= STORE_REAR_DOOR.sensor.actorHalfWidth \
		and absf(point[1] - STORE_REAR_DOOR.z) <= STORE_REAR_DOOR.sensor.actorHalfDepth

## Pure state transition used by the client animation and layout tests.
static func advance_rear_door_motion(current: Dictionary, occupied: bool, delta_ms: Variant) -> Dictionary:
	var safe_delta := maxf(0.0, minf(250.0, float(delta_ms) if JS.is_finite_number(delta_ms) else 0.0))
	var motion: Dictionary = STORE_REAR_DOOR.motion
	if occupied:
		var progress := minf(1.0, storefront_door_progress(current.progress) + safe_delta / motion.openMs)
		return {
			"progress": 1.0 if progress > 1 - 1e-9 else progress,
			"emptyForMs": 0,
		}
	var previous_empty_for_ms := maxf(0.0, float(current.emptyForMs))
	var empty_for_ms := minf(float(motion.holdOpenMs + motion.closeMs), previous_empty_for_ms + safe_delta)
	var closing_delta_ms := maxf(0.0, empty_for_ms - motion.holdOpenMs) - maxf(0.0, previous_empty_for_ms - motion.holdOpenMs)
	var progress := maxf(0.0, storefront_door_progress(current.progress) - closing_delta_ms / motion.closeMs)
	return {
		"progress": 0.0 if progress < 1e-9 else progress,
		"emptyForMs": empty_for_ms,
	}
