class_name CustomerVisualMotion
extends RefCounted
## Port of src/game/animation/CustomerVisualMotion.ts.
## Snapshot Dictionary: { x, z, targetX, targetZ, path: [[x, z], ...], speed, moving, capturedAtMs }.

const MOVING_STATES := [
	"ENTER_STORE",
	"NAVIGATE_TO_PRODUCT",
	"NAVIGATE_TO_QUEUE",
	"MOVE_QUEUE",
	"NAVIGATE_TO_BAG",
	"NAVIGATE_TO_RETURNS",
	"NAVIGATE_TO_CART_RETURN",
	"EXIT_STORE",
]

const MOVING_EMPLOYEE_STATES := [
	"NAVIGATE_PICKUP",
	"NAVIGATE_DROPOFF",
	"NAVIGATE_RETURN",
	"NAVIGATE_CHECKOUT",
]

static func capture_customer_motion(customer: Dictionary, captured_at_ms: int) -> Dictionary:
	return {
		"x": customer.x,
		"z": customer.z,
		"targetX": customer.targetX,
		"targetZ": customer.targetZ,
		"path": JS.slice(customer.path, customer.pathIndex),
		"speed": maxf(0.0, JS.get_or(customer, "currentSpeed", customer.speed)),
		"moving": MOVING_STATES.has(customer.state),
		"capturedAtMs": captured_at_ms,
	}

static func capture_employee_motion(employee: Dictionary, captured_at_ms: int) -> Dictionary:
	return {
		"x": employee.x,
		"z": employee.z,
		"targetX": employee.targetX,
		"targetZ": employee.targetZ,
		"path": JS.slice(employee.path, employee.pathIndex),
		"speed": maxf(0.0, JS.get_or(employee, "currentSpeed", employee.speed)),
		"moving": MOVING_EMPLOYEE_STATES.has(employee.state),
		"capturedAtMs": captured_at_ms,
	}

static func project_customer_motion(snapshot: Dictionary, now_ms: int, horizon_ms: int = Timing.CUSTOMER_VISUAL_HORIZON_MS) -> Dictionary:
	var path: Array = snapshot.path
	var waypoints: Array = path if not path.is_empty() else [[snapshot.targetX, snapshot.targetZ]]
	var any_distance := JS.some(waypoints, func(point): return JS.hypot(point[0] - snapshot.x, point[1] - snapshot.z) > 0.0001)
	if not snapshot.moving or snapshot.speed <= 0 or not any_distance:
		return { "x": snapshot.x, "z": snapshot.z, "headingX": 0.0, "headingZ": 0.0 }

	# World state is authoritative at a fixed interval. Project only through a
	# short safe horizon around the next expected snapshot so the render advances
	# continuously without inventing a route or leaving the NavMesh polyline.
	var elapsed_seconds := float(mini(maxi(0, now_ms - int(snapshot.capturedAtMs)), horizon_ms)) / 1000.0
	var remaining: float = snapshot.speed * elapsed_seconds
	var x: float = snapshot.x
	var z: float = snapshot.z
	var heading_x := 0.0
	var heading_z := 0.0
	for waypoint in waypoints:
		var target_x: float = waypoint[0]
		var target_z: float = waypoint[1]
		var dx := target_x - x
		var dz := target_z - z
		var distance := JS.hypot(dx, dz)
		if distance <= 0.0001: continue
		heading_x = dx / distance
		heading_z = dz / distance
		if remaining < distance:
			x += heading_x * remaining
			z += heading_z * remaining
			remaining = 0.0
			break
		x = target_x
		z = target_z
		remaining -= distance
		if remaining <= 0.0: break
	return { "x": x, "z": z, "headingX": heading_x, "headingZ": heading_z }
