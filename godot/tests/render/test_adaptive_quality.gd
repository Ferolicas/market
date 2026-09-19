extends TestCase

func test_regresses_only_after_sustained_over_budget_frames() -> void:
	var state: Dictionary = AdaptiveQuality.INITIAL_ADAPTIVE_QUALITY_STATE
	for frame in 8:
		var step := AdaptiveQuality.advance_adaptive_quality(state, 50)
		state = step.state
		assert_false(step.regress)
	var result := AdaptiveQuality.advance_adaptive_quality(state, 50)
	assert_true(result.regress)
	assert_false(result.recover)
	assert_eq(result.state.cooldownMs, 1200)

func test_recovers_accumulated_pressure_during_fast_frames_and_respects_cooldown() -> void:
	var warm := AdaptiveQuality.advance_adaptive_quality({ "slowForMs": 300, "cooldownMs": 0, "healthyForMs": 0 }, 16)
	assert_eq(warm.state.slowForMs, 268)
	assert_eq(warm.state.healthyForMs, 16)
	var cooling := AdaptiveQuality.advance_adaptive_quality({ "slowForMs": 500, "cooldownMs": 500, "healthyForMs": 0 }, 100)
	assert_false(cooling.regress)
	assert_eq(cooling.state.cooldownMs, 400)

func test_treats_a_capped_30_fps_mobile_frame_as_healthy() -> void:
	var result := AdaptiveQuality.advance_adaptive_quality({ "slowForMs": 300, "cooldownMs": 0, "healthyForMs": 0 }, 33.4)
	assert_false(result.regress)
	assert_near(result.state.slowForMs, 233.2, 0.005)

func test_hands_one_step_back_only_after_a_long_run_of_in_budget_frames() -> void:
	var state: Dictionary = AdaptiveQuality.INITIAL_ADAPTIVE_QUALITY_STATE
	var recovered := 0
	for frame in 700:
		var result := AdaptiveQuality.advance_adaptive_quality(state, 16.7)
		state = result.state
		if result.recover: recovered += 1
	# 700 × 16.7 ms ≈ 11.7 s: exactly one recovery at 8 s, counter restarted.
	assert_eq(recovered, 1)
	assert_lt(state.healthyForMs, AdaptiveQuality.MOBILE_ADAPTIVE_QUALITY.recoverAfterMs)
	# A single slow frame restarts the healthy streak.
	var interrupted := AdaptiveQuality.advance_adaptive_quality({ "slowForMs": 0, "cooldownMs": 0, "healthyForMs": 7900 }, 60)
	assert_eq(interrupted.state.healthyForMs, 0)
	assert_false(interrupted.recover)

func test_steps_resolution_down_and_back_within_the_profile_bounds() -> void:
	var mobile := AdaptiveQuality.market_render_profile_for_capabilities({ "width": 390, "coarsePointer": true, "devicePixelRatio": 3 })
	var once := AdaptiveQuality.regressed_dpr(mobile.dpr, mobile)
	assert_near(once, 1.72, 0.005)
	var twice := AdaptiveQuality.regressed_dpr(once, mobile)
	assert_eq(twice, mobile.minDpr)
	assert_near(AdaptiveQuality.recovered_dpr(twice, mobile), 1.744, 0.005)
	assert_eq(AdaptiveQuality.recovered_dpr(1.95, mobile), mobile.dpr)

func test_renders_at_native_density_on_both_platforms_without_glass_transmission_passes_on_mobile() -> void:
	assert_eq(AdaptiveQuality.market_render_profile_for_capabilities({ "width": 390, "coarsePointer": true, "devicePixelRatio": 3 }), {
		"mobile": true, "dpr": 2, "minDpr": 1.5, "targetFps": 30, "motionFps": 60, "antialias": true, "shadowMapSize": 512,
		"transmissionResolutionScale": 0.5, "glassTransmission": false, "powerPreference": "low-power",
	})
	assert_eq(AdaptiveQuality.market_render_profile_for_capabilities({ "width": 390, "coarsePointer": true, "devicePixelRatio": 1 }).dpr, 1)
	assert_eq(AdaptiveQuality.market_render_profile_for_capabilities({ "width": 1440, "coarsePointer": false, "devicePixelRatio": 2 }), {
		"mobile": false, "dpr": 2, "minDpr": 0.85, "targetFps": 60, "motionFps": 60, "antialias": true, "shadowMapSize": 1024,
		"transmissionResolutionScale": 1, "glassTransmission": true, "powerPreference": "high-performance",
	})
	assert_eq(AdaptiveQuality.market_render_profile_for_capabilities({ "width": 1920, "coarsePointer": false, "devicePixelRatio": 1 }).dpr, 1)
	assert_eq(AdaptiveQuality.market_render_profile_for_capabilities({ "width": 2560, "coarsePointer": false, "devicePixelRatio": 3 }).dpr, 2)

func test_keeps_the_historical_renderer_profile_available_only_for_controlled_ab_measurements() -> void:
	assert_eq(AdaptiveQuality.legacy_mobile_render_profile({ "width": 390, "coarsePointer": true, "devicePixelRatio": 3 }), {
		"mobile": true, "dpr": 1.204, "minDpr": 0.75, "targetFps": 60, "motionFps": 60, "antialias": true, "shadowMapSize": 1024,
		"transmissionResolutionScale": 1, "glassTransmission": true, "powerPreference": "high-performance", "baseline": true,
	})

func _feed(estimator: AdaptiveQuality.DisplayCadenceEstimator, deltas: Array) -> float:
	var now := 1000.0
	var interval := estimator.observe(now)
	for delta in deltas:
		now += delta
		interval = estimator.observe(now)
	return interval

func test_estimates_the_panel_refresh_from_the_shortest_recent_frame_delta() -> void:
	assert_near(_feed(AdaptiveQuality.DisplayCadenceEstimator.new(), [16.6, 16.8, 16.7, 33.4, 16.7, 50]), 16.6, 0.005)
	assert_near(_feed(AdaptiveQuality.DisplayCadenceEstimator.new(), [8.3, 8.4, 16.7, 8.3]), 8.3, 0.005)
	assert_near(_feed(AdaptiveQuality.DisplayCadenceEstimator.new(), [11.1, 11.2, 22.2, 11.1]), 11.1, 0.005)
	assert_near(AdaptiveQuality.DisplayCadenceEstimator.new().refresh_interval_ms(), 16.667, 0.005)

func test_presents_on_an_even_sub_multiple_of_the_refresh_rate() -> void:
	assert_eq(AdaptiveQuality.presentation_divisor(16.7, 60), 1)
	assert_eq(AdaptiveQuality.presentation_divisor(16.7, 30), 2)
	assert_eq(AdaptiveQuality.presentation_divisor(8.33, 60), 2)
	assert_eq(AdaptiveQuality.presentation_divisor(8.33, 30), 4)
	assert_eq(AdaptiveQuality.presentation_divisor(11.1, 60), 2)
	assert_eq(AdaptiveQuality.presentation_divisor(11.1, 30), 3)
	# A 30 Hz low-power panel simply presents every tick.
	assert_eq(AdaptiveQuality.presentation_divisor(33.3, 60), 1)
	assert_eq(AdaptiveQuality.presentation_divisor(33.3, 30), 1)

func test_ignores_stale_history_after_a_reset() -> void:
	var estimator := AdaptiveQuality.DisplayCadenceEstimator.new(8)
	_feed(estimator, [8.3, 8.3, 8.3])
	estimator.reset()
	assert_near(_feed(estimator, [16.7, 16.7]), 16.7, 0.005)
