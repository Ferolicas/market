extends TestCase

const MOVING := {
	"x": 1.0, "z": 2.0, "targetX": 5.0, "targetZ": 2.0, "path": [[5.0, 2.0]],
	"speed": 2.0, "moving": true, "capturedAtMs": 1000,
}

func _assert_match(actual: Dictionary, expected: Dictionary) -> void:
	for key in expected: assert_eq(actual.get(key), expected[key], key)

func test_fills_the_100_ms_simulation_gap_with_continuous_forward_motion() -> void:
	_assert_match(CustomerVisualMotion.project_customer_motion(MOVING, 1050), { "x": 1.1, "z": 2.0, "headingX": 1.0, "headingZ": 0.0 })
	_assert_match(CustomerVisualMotion.project_customer_motion(MOVING, 1100), { "x": 1.2, "z": 2.0, "headingX": 1.0, "headingZ": 0.0 })

func test_never_projects_through_a_waypoint_or_beyond_the_safe_snapshot_horizon() -> void:
	assert_near(CustomerVisualMotion.project_customer_motion(JS.spread(MOVING, { "targetX": 1.2, "path": [[1.2, 2.0]] }), 1250).x, 1.2, 0.005)
	assert_near(CustomerVisualMotion.project_customer_motion(MOVING, 5000).x, 1.6, 0.005)

func test_uses_the_whole_navmesh_polyline_instead_of_pausing_at_short_waypoints() -> void:
	var projected := CustomerVisualMotion.project_customer_motion(JS.spread(MOVING, { "x": 0.0, "z": 0.0, "targetX": 0.04, "targetZ": 0.0, "path": [[0.04, 0.0], [0.08, 0.0], [1.0, 0.0]] }), 1100)
	assert_near(projected.x, 0.2, 0.005)
	assert_eq(projected.headingX, 1.0)

func test_holds_an_authoritative_stationary_pose() -> void:
	assert_eq(CustomerVisualMotion.project_customer_motion(JS.spread(MOVING, { "moving": false }), 1250), { "x": 1.0, "z": 2.0, "headingX": 0.0, "headingZ": 0.0 })

func test_projects_a_moving_employee_while_preserving_the_configured_level_speed() -> void:
	var employee := {
		"state": "NAVIGATE_PICKUP", "assignedProduct": "tomatoes", "assignedStationId": "stockroom",
		"carry": { "capacity": 4, "items": {} }, "x": 0.0, "z": 0.0, "targetX": 2.0, "targetZ": 0.0,
		"path": [[2.0, 0.0]], "pathIndex": 0, "speed": 1.82, "currentSpeed": 1.82, "stateSince": 0,
	}
	var snapshot := CustomerVisualMotion.capture_employee_motion(employee, 1000)
	assert_eq(snapshot.speed, 1.82)
	assert_near(CustomerVisualMotion.project_customer_motion(snapshot, 1100).x, 0.182, 0.005)

func test_keeps_rendering_a_stocker_in_motion_while_they_carry_overflow_to_returns() -> void:
	var employee := {
		"state": "NAVIGATE_RETURN", "assignedProduct": "apples", "assignedStationId": "fixture:warehouse-return",
		"carry": { "capacity": 4, "items": { "apples": 2 } }, "x": 0.0, "z": 0.0, "targetX": 2.0, "targetZ": 0.0,
		"path": [[2.0, 0.0]], "pathIndex": 0, "speed": 1.5, "currentSpeed": 1.5, "stateSince": 0,
	}
	var snapshot := CustomerVisualMotion.capture_employee_motion(employee, 1000)
	assert_true(snapshot.moving)
	assert_near(CustomerVisualMotion.project_customer_motion(snapshot, 1100).x, 0.15, 0.005)
