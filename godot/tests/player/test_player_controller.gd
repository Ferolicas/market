extends TestCase
## Port of src/game/player/PlayerController.test.ts

func test_maps_screen_input_through_camera_forward() -> void:
	assert_eq(PlayerController.camera_relative_movement({ "x": 0, "y": -1, "magnitude": 1 }, Vector2(0, -1)), Vector2(0, -1))
	assert_eq(PlayerController.camera_relative_movement({ "x": 1, "y": 0, "magnitude": 1 }, Vector2(0, -1)), Vector2(1, 0))
	assert_eq(PlayerController.camera_relative_movement({ "x": -1, "y": 0, "magnitude": 1 }, Vector2(0, -1)), Vector2(-1, 0))

func test_accelerates_and_brakes_in_units_per_second() -> void:
	var accelerated := PlayerController.move_velocity(Vector2(0, 0), Vector2(1, 0), 1.0 / 60)
	assert_near(accelerated.x, 0.2, 0.005)
	var stopped := PlayerController.move_velocity(Vector2(0.1, 0), Vector2(0, 0), 1.0 / 60)
	assert_eq(stopped, Vector2(0, 0))

func test_anade_25_por_mejora_hasta_duplicar_la_velocidad() -> void:
	var tier_one := PlayerController.player_motion_for_tier(1)
	var tier_two := PlayerController.player_motion_for_tier(2)
	var tier_ten := PlayerController.player_motion_for_tier(10)
	var defaults: Dictionary = PlayerController.DEFAULT_PLAYER_MOTION

	assert_near(tier_one.walkSpeed, defaults.walkSpeed * PlayerController.PLAYER_TIER_ONE_SPEED_MULTIPLIER, 0.005)
	assert_near(tier_one.walkSpeed, 3.564, 0.005)
	assert_near(tier_ten.walkSpeed, tier_one.walkSpeed * 2, 0.005)
	assert_near(tier_ten.walkSpeed, 7.128, 0.005)
	assert_eq(tier_one.acceleration, defaults.acceleration * PlayerController.PLAYER_MAX_SPEED_MULTIPLIER)
	assert_eq(tier_one.braking, defaults.braking * PlayerController.PLAYER_MAX_SPEED_MULTIPLIER)
	assert_gt(tier_two.walkSpeed, tier_one.walkSpeed)
	assert_eq(PlayerController.player_motion_for_tier(99), tier_ten)

func test_normaliza_tiers_persistidos_invalidos_antes_de_calcular_movimiento() -> void:
	assert_eq(PlayerController.player_motion_for_tier(NAN), PlayerController.player_motion_for_tier(1))
	assert_eq(PlayerController.player_motion_for_tier(-3), PlayerController.player_motion_for_tier(1))

func test_preserves_the_starting_campaign_speed_and_doubles_it_in_four_steps() -> void:
	var previous_start: float = PlayerController.DEFAULT_PLAYER_MOTION.walkSpeed * PlayerController.PLAYER_MAX_SPEED_MULTIPLIER * 0.7
	var maximum: float = PlayerController.player_motion_for_tier(10, true).walkSpeed
	assert_near(PlayerController.player_motion_for_tier(1, true).walkSpeed, previous_start * 2.5 * 0.8, 0.005)
	assert_near(PlayerController.player_motion_for_tier(1, true).walkSpeed, 8.316, 0.005)
	assert_near(maximum, 16.632, 0.005)
	assert_near(PlayerController.player_motion_for_tier(1, true).walkSpeed, maximum * 0.5, 0.005)
	assert_near(PlayerController.player_motion_for_tier(2, true).walkSpeed, PlayerController.player_motion_for_tier(1, true).walkSpeed * 1.25, 0.005)
	assert_near(PlayerController.player_motion_for_tier(10, true).walkSpeed, maximum, 0.005)
	for tier in range(2, 6):
		assert_gt(PlayerController.player_motion_for_tier(tier, true).walkSpeed, PlayerController.player_motion_for_tier(tier - 1, true).walkSpeed)
