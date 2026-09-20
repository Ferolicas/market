class_name EnginePaths
extends RefCounted
## Exact authoritative fallback routing and actor integration from engine.ts.
const DOOR_OUTSIDE_WAIT_Z = 8.35
const DOOR_INSIDE_WAIT_Z = 7.25
const LANE_APPROACH_ROWS = [-1.8, -4.4, 0.45, 5.6]

static func compact_path(start: Array, path: Array) -> Array:
	var previous := start
	var result: Array = []
	for point in path:
		if JS.hypot(point[0] - previous[0], point[1] - previous[1]) > 0.05:
			result.append(point)
			previous = point
	return result

static func same_store_point(left: Array, right: Array) -> bool:
	return JS.hypot(left[0] - right[0], left[1] - right[1]) < 0.01

static func lane_approach(point: Array) -> Array:
	var direct: Array = [3.1, minf(5.6, point[1])]
	if WorldScale.store_segment_is_clear(point, direct): return [direct]
	for z in LANE_APPROACH_ROWS:
		var corner: Array = [point[0], z]
		var lane_at: Array = [3.1, z]
		if WorldScale.store_segment_is_clear(point, corner) and WorldScale.store_segment_is_clear(corner, lane_at): return [corner, lane_at]
	return [direct]

static func customer_path(start: Array, target: Array) -> Array:
	if same_store_point(target, StoreServiceLayout.RETURNS_POINT):
		var approaches: Array = StoreServiceLayout.STORE_SERVICE_FIXTURES.returns.approach.duplicate(true)
		return compact_path(start, approaches + [StoreServiceLayout.RETURNS_POINT.duplicate()])
	if same_store_point(target, StoreServiceLayout.CART_RETURN_POINT) and JS.hypot(start[0] - StoreServiceLayout.RETURNS_POINT[0], start[1] - StoreServiceLayout.RETURNS_POINT[1]) < 1.5:
		return compact_path(start, StoreServiceLayout.RETURNS_TO_CART_FALLBACK.duplicate(true))
	var starts_outside: bool = start[1] > DOOR_OUTSIDE_WAIT_Z
	var ends_outside: bool = target[1] > DOOR_OUTSIDE_WAIT_Z
	if starts_outside and not ends_outside:
		var doorway_x: float = clampf(start[0], -0.82, 0.82)
		var inside_start: Array = [doorway_x, 5.6]
		return compact_path(start, [[doorway_x, 9], inside_start] + customer_path(inside_start, target))
	if not starts_outside and ends_outside:
		var doorway_x: float = clampf(target[0], -0.82, 0.82)
		return compact_path(start, [[start[0], 5.6], [doorway_x, 5.6], [doorway_x, 9], target])
	if not starts_outside and not ends_outside and WorldScale.store_segment_is_clear(start, target): return compact_path(start, [target])
	var path: Array = []
	if start[1] > 5.6: path.append([start[0], 5.6])
	path.append_array(lane_approach(start if path.is_empty() else path.back()))
	var reverse := lane_approach(target)
	reverse.reverse()
	path.append_array(reverse)
	path.append(target)
	return compact_path(start, path)

static func is_legacy_farm_service_lane_point(point: Array) -> bool:
	return point[0] >= FarmLayout.FARM_FIELD.serviceLaneX - 0.7 and point[0] <= 13 and point[1] >= -12.1 and point[1] <= 9.15

static func is_rear_farm_point(point: Array) -> bool:
	var front_edge: float = FarmLayout.FARM_FIELD.center[2] + FarmLayout.FARM_FIELD.size[2] / 2.0
	return point[1] <= front_edge + 0.5 and not is_legacy_farm_service_lane_point(point)

static func is_rear_stockroom_point(point: Array) -> bool:
	return point[0] >= WarehouseLayout.STOCKROOM_POINT[0] - 1.5 and point[0] <= WarehouseLayout.STOCKROOM_POINT[0] + 1.7 and point[1] <= -4.2 and point[1] > -6.6

static func store_interior_route_to_rear_door(start: Array) -> Array:
	var corridor: Array = StorefrontLayout.STORE_REAR_DOOR.interiorCorridor.duplicate(true)
	if is_rear_stockroom_point(start): return compact_path(start, [corridor.back()])
	return compact_path(start, customer_path(start, corridor[0]) + corridor.slice(1))

static func store_interior_route_from_rear_door(target: Array) -> Array:
	var corridor: Array = StorefrontLayout.STORE_REAR_DOOR.interiorCorridor.duplicate(true)
	var inside: Array = corridor.back()
	if is_rear_stockroom_point(target): return compact_path(inside, [target])
	var reverse: Array = corridor.slice(0, corridor.size() - 1)
	reverse.reverse()
	return compact_path(inside, reverse + customer_path(corridor[0], target))

static func safe_fallback_path(start: Array, target: Array) -> Array:
	var inside: Array = FarmLayout.FARM_ACCESS_WAYPOINTS[0].duplicate()
	var outside: Array = FarmLayout.FARM_ACCESS_WAYPOINTS[1].duplicate()
	var gate: Array = FarmLayout.FARM_ACCESS_WAYPOINTS[2].duplicate()
	var start_at_farm := is_rear_farm_point(start)
	var target_at_farm := is_rear_farm_point(target)
	if start_at_farm == target_at_farm:
		if start_at_farm: return compact_path(start, FarmLayout.farm_interior_route_between(start, target))
		var target_inside: bool = absf(target[0]) < 11.13 and target[1] > -8.2 and target[1] < 7.55
		if is_legacy_farm_service_lane_point(start) and target_inside:
			return compact_path(start, [[FarmLayout.FARM_FIELD.serviceLaneX, outside[1]], outside, inside] + store_interior_route_from_rear_door(target))
		if start[1] > DOOR_OUTSIDE_WAIT_Z and absf(start[0]) > 1.82 and target_inside:
			var inside_door: Array = [0, DOOR_INSIDE_WAIT_Z]
			return compact_path(start, [[0, DOOR_OUTSIDE_WAIT_Z], inside_door] + customer_path(inside_door, target))
		return customer_path(start, target)
	if target_at_farm:
		var path: Array = []
		if absf(start[0]) < 11.13 and start[1] > -8.2 and start[1] < 7.55:
			path.append_array(store_interior_route_to_rear_door(start))
			path.append(outside)
		elif is_legacy_farm_service_lane_point(start): path.append_array([[FarmLayout.FARM_FIELD.serviceLaneX, outside[1]], outside])
		else: path.append(outside)
		path.append(gate)
		path.append_array(FarmLayout.farm_interior_route_from_entrance(target))
		return compact_path(start, path)
	return compact_path(start, FarmLayout.farm_interior_route_to_entrance(start) + [outside, inside] + store_interior_route_from_rear_door(target))

static func navigate_path(pathfinder: Callable, start: Array, target: Array) -> Array:
	var path: Variant = pathfinder.call(start, target) if pathfinder.is_valid() else []
	if path != null and not path.is_empty(): return compact_path(start, path)
	return safe_fallback_path(start, target)

static func queue_position(slot: int, lane: int = 0) -> Array:
	# Preserve the source's lane mapping, including its current third-lane behavior.
	return CheckoutLayout.checkout_queue_position(slot, 1 if lane == 1 else 0)

static func queue_arrival_path(pathfinder: Callable, start: Array, slot: int, lane: int = 0) -> Array:
	var arrival := CheckoutLayout.checkout_queue_arrival(slot, 1 if lane == 1 else 0)
	return compact_path(start, navigate_path(pathfinder, start, arrival[0].duplicate()) + [arrival[1].duplicate()])

static func set_customer_state(customer: Dictionary, state: String, now: float) -> void:
	customer.state = state
	customer.stateSince = now

static func set_customer_path(customer: Dictionary, path: Array) -> void:
	customer.path = path
	customer.pathIndex = 0
	var first: Array = path[0] if not path.is_empty() else [customer.x, customer.z]
	customer.targetX = first[0]
	customer.targetZ = first[1]

static func walk_path_actor(actor: Dictionary, delta_ms: float) -> bool:
	if actor.pathIndex >= actor.path.size(): return true
	var seconds := delta_ms / 1000.0
	var remaining_distance := 0.0
	var path_x: float = actor.x
	var path_z: float = actor.z
	for index in range(actor.pathIndex, actor.path.size()):
		var next: Array = actor.path[index]
		remaining_distance += JS.hypot(next[0] - path_x, next[1] - path_z)
		path_x = next[0]
		path_z = next[1]
	var braking := sqrt(maxf(0, 2 * 6.2 * remaining_distance))
	var desired: float = minf(actor.speed, braking)
	var current: float = JS.get_or(actor, "currentSpeed", 0)
	actor.currentSpeed = minf(desired, current + 5.2 * seconds) if current < desired else maxf(desired, current - 6.2 * seconds)
	var remaining_step: float = actor.currentSpeed * seconds
	var guard: int = actor.path.size() + 1
	while remaining_step >= 0 and actor.pathIndex < actor.path.size() and guard > 0:
		guard -= 1
		var target: Array = actor.path[actor.pathIndex]
		actor.targetX = target[0]
		actor.targetZ = target[1]
		var dx: float = target[0] - actor.x
		var dz: float = target[1] - actor.z
		var distance := JS.hypot(dx, dz)
		if distance > remaining_step + 1e-9 and distance >= 0.025:
			actor.x += dx / distance * remaining_step
			actor.z += dz / distance * remaining_step
			remaining_step = -1
			break
		actor.x = target[0]
		actor.z = target[1]
		actor.pathIndex += 1
		remaining_step -= distance
	if actor.pathIndex < actor.path.size():
		actor.targetX = actor.path[actor.pathIndex][0]
		actor.targetZ = actor.path[actor.pathIndex][1]
	var arrived: bool = actor.pathIndex >= actor.path.size()
	if arrived: actor.currentSpeed = 0
	return arrived

static func walk_customer_through_automatic_door(customer: Dictionary, franchise: Dictionary, delta_ms: float, direction: String) -> bool:
	var before_z: float = customer.z
	var arrived := walk_path_actor(customer, delta_ms)
	if franchise.doorState == "OPEN" and franchise.doorProgress >= 1: return arrived
	var entering: bool = direction == "ENTER" and before_z >= StorefrontLayout.STOREFRONT_LAYOUT.z
	var exiting: bool = direction == "EXIT" and before_z <= StorefrontLayout.STOREFRONT_LAYOUT.z
	if (entering and customer.z < DOOR_OUTSIDE_WAIT_Z) or (exiting and customer.z > DOOR_INSIDE_WAIT_Z):
		customer.z = DOOR_OUTSIDE_WAIT_Z if entering else DOOR_INSIDE_WAIT_Z
		customer.currentSpeed = 0
		if customer.pathIndex < customer.path.size(): customer.targetZ = customer.path[customer.pathIndex][1]
		return false
	return arrived

static func apply_customer_avoidance(customers: Array) -> void:
	var moving := ["ENTER_STORE", "NAVIGATE_TO_PRODUCT", "NAVIGATE_TO_QUEUE", "MOVE_QUEUE", "NAVIGATE_TO_BAG", "NAVIGATE_TO_RETURNS", "NAVIGATE_TO_CART_RETURN", "EXIT_STORE"]
	var cells := {}
	for first_index in customers.size():
		var first: Dictionary = customers[first_index]
		if first.state not in moving: continue
		var cell_x := floori(first.x / 0.6)
		var cell_z := floori(first.z / 0.6)
		for offset_x in range(-1, 2):
			for offset_z in range(-1, 2):
				for second_index in cells.get("%d:%d" % [cell_x + offset_x, cell_z + offset_z], []):
					var second: Dictionary = customers[second_index]
					var dx: float = second.x - first.x
					var dz: float = second.z - first.z
					var distance := JS.hypot(dx, dz)
					if distance >= 0.6: continue
					var nx: float = dx / distance if distance > 0.001 else (1 if first.id < second.id else -1)
					var nz: float = dz / distance if distance > 0.001 else 0
					var correction := minf(0.08, (0.6 - distance) * 0.5)
					first.x -= nx * correction
					first.z -= nz * correction
					second.x += nx * correction
					second.z += nz * correction
		var key := "%d:%d" % [floori(first.x / 0.6), floori(first.z / 0.6)]
		if key not in cells: cells[key] = []
		cells[key].append(first_index)

static func walk_employee_through_automatic_door(runtime: Dictionary, franchise: Dictionary, delta_ms: float) -> bool:
	var before_x: float = runtime.x
	var before_z: float = runtime.z
	if franchise.doorState == "OPEN" and franchise.doorProgress >= 1: return walk_path_actor(runtime, delta_ms)
	var target: Variant = runtime.path[runtime.pathIndex] if runtime.pathIndex < runtime.path.size() else null
	var half_width: float = StorefrontLayout.STOREFRONT_LAYOUT.door.outerPostX
	var passage_z: float = StorefrontLayout.STOREFRONT_LAYOUT.z
	var uses_door: bool = target != null and absf(before_x) <= half_width and absf(target[0]) <= half_width
	var entering: bool = uses_door and before_z >= passage_z and target[1] < passage_z and before_z <= DOOR_OUTSIDE_WAIT_Z + 0.02
	var exiting: bool = uses_door and before_z <= passage_z and target[1] > passage_z and before_z >= DOOR_INSIDE_WAIT_Z - 0.02
	if entering or exiting:
		runtime.z = DOOR_OUTSIDE_WAIT_Z if entering else DOOR_INSIDE_WAIT_Z
		runtime.currentSpeed = 0
		runtime.targetZ = target[1]
		return false
	var arrived := walk_path_actor(runtime, delta_ms)
	var crossed: bool = absf(before_x) <= half_width and absf(runtime.x) <= half_width
	entering = crossed and before_z >= passage_z and runtime.z < passage_z
	exiting = crossed and before_z <= passage_z and runtime.z > passage_z
	if entering or exiting:
		runtime.z = DOOR_OUTSIDE_WAIT_Z if entering else DOOR_INSIDE_WAIT_Z
		runtime.currentSpeed = 0
		if runtime.pathIndex < runtime.path.size(): runtime.targetZ = runtime.path[runtime.pathIndex][1]
		return false
	return arrived
