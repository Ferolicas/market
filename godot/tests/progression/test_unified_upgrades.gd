extends TestCase
## Port of src/game/progression/UnifiedUpgrades.test.ts (engine-free part).
## The player-motion and normalizeGameState lines live in test_unified_upgrades_engine.gd.

func test_uses_25_percent_base_speed_and_production_at_each_tier() -> void:
	for tier in [1, 2, 3, 4, 5]:
		var multiplier: float = 1 + (tier - 1) * .25
		assert_eq(Levels.station_tier_modifiers(tier), { "speed": multiplier, "capacity": multiplier, "value": 1 })
		assert_eq(EmployeeStats.employee_training_multiplier(tier), multiplier)
		assert_eq(EmployeeStats.employee_carry_capacity(tier), [3, 4, 6, 8, 10][tier - 1])
		assert_eq(StationSystem.machine_cycle_ms(StationSystem.create_machine("flour-mill-1", "flour", tier)), 4000 / multiplier)
		assert_eq(StationSystem.crop_harvest_yield("tomatoes", tier, 8), 8 * multiplier)
		assert_near(float(StationSystem.crop_growth_duration_ms("tomatoes", 1, 30)) / StationSystem.crop_growth_duration_ms("tomatoes", tier, 30), multiplier, 0.005)
		assert_eq(FedAnimal.animal_production("eggs", tier)["capacity"], 4 * multiplier)
		assert_eq(FedAnimal.animal_production("milk", tier)["cycleMs"], JS.round(6000 / multiplier))
