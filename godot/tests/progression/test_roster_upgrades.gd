extends TestCase
## Port of src/game/progression/RosterUpgrades.test.ts (engine-free case).
## The cases needing MarketEngine live in test_roster_upgrades_engine.gd.

func test_prices_four_doubling_steps_triple_for_machines() -> void:
	assert_eq(RosterUpgrades.ROSTER_UPGRADE_STEPS, 4)
	assert_eq(JS.map([0, 1, 2, 3], func(step): return RosterUpgrades.roster_step_cost("player", step)), [8000, 16000, 32000, 64000])
	assert_eq(JS.map([0, 1, 2, 3], func(step): return RosterUpgrades.roster_step_cost("machine", step)), [24000, 48000, 96000, 192000])
	assert_eq(RosterUpgrades.MACHINE_BASE_COST_MINOR, RosterUpgrades.ROSTER_BASE_COST_MINOR * 3)

func test_lists_a_hand_built_store_with_real_multipliers() -> void:
	var franchise := {
		"playerSpeedTier": 2, "carry": { "capacity": 4, "items": {} },
		"employees": [
			{ "id": "e1", "name": "Luna", "role": "cashier", "level": 5, "salaryMinor": 0, "energy": 100, "hat": "frog" },
			{ "id": "e2", "name": "Mateo", "role": "farmer", "level": 2, "salaryMinor": 0, "energy": 100, "hat": "frog" },
		],
		"productionMachines": [
			StationSystem.create_machine("chicken-coop-1", "eggs", 1),
			StationSystem.create_machine("flour-mill-1", "flour", 2),
			JS.spread(StationSystem.create_machine("juice-machine-1", "juice"), { "status": "LOCKED" }),
		],
		"crops": [StationSystem.create_crop("crop-wheat-1", "wheat", 0, 1, 1, StationSystem.CAMPAIGN_BED_YIELD)],
	}
	var entries := RosterUpgrades.roster_entries(franchise, 1)
	assert_eq(JS.map(entries, func(entry): return entry["id"]), ["player", "employee:e1", "employee:e2", "station:chicken-coop-1", "station:flour-mill-1", "station:crop-wheat-1"])
	assert_eq(entries[0]["detail"], "Cesta 4 · velocidad T2")
	assert_eq(entries[0]["step"], 1)
	assert_near(entries[0]["capacity"], 1.33, 0.001)
	assert_eq(entries[1]["detail"], "Cajero · escaneo ×2.00")
	assert_eq(entries[1]["speed"], 2.0)
	assert_eq(entries[1]["nextCostMinor"], null)
	assert_eq(entries[2]["detail"], "Granjero-reponedor · cesta 4")
	assert_near(entries[2]["speed"], 1.25)
	assert_near(entries[2]["capacity"], 1.33, 0.001)
	assert_eq(entries[3]["detail"], "Produce huevos · comedero 4")
	assert_eq(entries[3]["label"], "Primera gallina")
	assert_eq(entries[4]["detail"], "Produce harina · almacén 10 · cola 20 trigo")
	assert_eq(entries[4]["label"], "Molino")
	assert_eq(entries[4]["stepCostsMinor"], [24000, 48000, 96000, 192000])
	assert_eq(entries[4]["nextCostMinor"], 48000)
	assert_eq(entries[5]["detail"], "Cosecha 8 por ciclo")
	assert_true(JS.every(entries, func(entry): return entry["stepCostsMinor"].size() == 4))
