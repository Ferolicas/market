extends TestCase
## Port of src/game/locomotion.test.ts

func test_caps_long_frames_so_a_stalled_tab_cannot_teleport_a_character() -> void:
	assert_eq(Locomotion.frame_delta(0.4), 0.05)
	assert_near(Locomotion.frame_delta(1.0 / 60), 1.0 / 60, 0.005)

func test_uses_frame_rate_independent_damping() -> void:
	assert_near(Locomotion.damp_factor(10, 1.0 / 60), 1 - exp(-10.0 / 60), 0.005)

func test_turns_through_the_shortest_arc_without_snapping() -> void:
	var current := PI - 0.1
	var target := -PI + 0.1
	assert_near(Locomotion.turn_towards(current, target, 0.05), current + 0.05, 0.005)
	assert_near(Locomotion.turn_towards(0, PI / 2, 0.2), 0.2, 0.005)

func test_keeps_travel_mostly_linear_with_short_acceleration_ramps() -> void:
	assert_eq(Locomotion.travel_progress(0), 0.0)
	assert_near(Locomotion.travel_progress(0.5), 0.5, 0.005)
	assert_eq(Locomotion.travel_progress(1), 1.0)
	var middle_step := Locomotion.travel_progress(0.6) - Locomotion.travel_progress(0.5)
	var next_step := Locomotion.travel_progress(0.7) - Locomotion.travel_progress(0.6)
	assert_near(middle_step, next_step, 0.005)

func test_keeps_the_visitor_route_continuous_through_every_phase() -> void:
	var route: Dictionary = Locomotion.VISITOR_ROUTES[1]
	var previous: Array = Locomotion.sample_visitor_journey(0, -0.82, route).position
	var largest_step := 0.0
	var time := 1.0 / 60
	while time <= 47:
		var current: Array = Locomotion.sample_visitor_journey(time, -0.82, route).position
		largest_step = maxf(largest_step, JS.hypot(current[0] - previous[0], current[1] - previous[1]))
		previous = current
		time += 1.0 / 60
	assert_lt(largest_step, 0.08)
	assert_eq(Locomotion.sample_visitor_journey(29, -0.82, route).position, route.queue)
	assert_eq(Locomotion.sample_visitor_journey(30.5, -0.82, route).position, CheckoutLayout.CHECKOUT_LANES[0].customerFront)

func test_keeps_every_visitor_clear_of_enlarged_furniture_for_the_full_journey() -> void:
	for id in Locomotion.VISITOR_ROUTES:
		var route: Dictionary = Locomotion.VISITOR_ROUTES[id]
		var entry_x := -0.82 if int(id) % 2 else 0.82
		var time := 0.0
		while time <= 47:
			var point := WorldScale.scale_store_point(Locomotion.sample_visitor_journey(time, entry_x, route).position)
			assert_false(WorldScale.overlaps_store_obstacle(point, 0.55), "visitor %s intersects furniture at %ss" % [id, JS.to_fixed(time, 2)])
			time += 1.0 / 30
