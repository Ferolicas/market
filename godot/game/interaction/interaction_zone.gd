class_name InteractionZone
extends RefCounted
## Port of src/game/interaction/InteractionZone.ts (module-level constants and
## pure functions). The stateful `InteractionZoneState` class lives in
## interaction_zone_state.gd.
##
## Zone config Dictionary keys (camelCase, like the TS interface):
## id, type, x, z, halfExtents (optional [halfX, halfZ]), enterRadius,
## exitRadius, actorMask (Array of "player"|"customer"|"employee"), priority,
## dwellMs, repeatEveryMs, exitGraceMs (optional), channel
## ("passive"|"transfer"|"hands").
## Zone events are Dictionaries { "zone": config, "signal": "enter"|"tick"|"exit" }.

## A magnet is the element itself. Its reach, measured outwards from the solid
## footprint in scaled simulation units, only covers the owner's own body
## (capsule radius 0.24) plus a brushing tolerance, so nothing activates
## before the player is actually touching the fixture. Never scale this by
## the element scale: the body does not grow with the furniture.
const CONTACT_MAGNET_REACH = { "enter": 0.38, "exit": 0.55 }

static func _half_extent(config: Dictionary, axis: int) -> float:
	var half_extents = config.get("halfExtents")
	if half_extents == null: return 0.0
	return maxf(0.0, float(half_extents[axis]))

static func interaction_zone_planar_distance(config: Dictionary, x: float, z: float) -> float:
	var half_x := _half_extent(config, 0)
	var half_z := _half_extent(config, 1)
	var outside_x := maxf(0.0, absf(x - config.x) - half_x)
	var outside_z := maxf(0.0, absf(z - config.z) - half_z)
	return JS.hypot(outside_x, outside_z)

## Exact compound representation of a rounded rectangle in the XZ plane.
## Primitives: { "kind": "box", "halfX", "halfZ" } or
## { "kind": "circle", "offsetX", "offsetZ", "radius" }.
static func interaction_zone_sensor_primitives(config: Dictionary) -> Array:
	var half_x := _half_extent(config, 0)
	var half_z := _half_extent(config, 1)
	var radius := maxf(0.0, float(config.enterRadius))
	if half_x == 0.0 and half_z == 0.0:
		return [{ "kind": "circle", "offsetX": 0.0, "offsetZ": 0.0, "radius": radius }]
	var primitives := [
		{ "kind": "box", "halfX": half_x + radius, "halfZ": half_z },
		{ "kind": "box", "halfX": half_x, "halfZ": half_z + radius },
	]
	for side_x in [-1, 1]:
		for side_z in [-1, 1]:
			primitives.append({ "kind": "circle", "offsetX": side_x * half_x, "offsetZ": side_z * half_z, "radius": radius })
	return primitives
