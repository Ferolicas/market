extends TestCase
## Port of src/game/progression/CampaignTasks.test.ts (engine-free part).
## The cases needing MarketEngine live in test_campaign_tasks_engine.gd.

func test_starts_all_personal_tasks_empty() -> void:
	for id in CampaignTasks.CAMPAIGN_TASK_IDS: assert_false(CampaignTasks.campaign_task_status(id)["completed"], id)

func test_caps_progress_deltas_at_the_location_target_and_ignores_invalid_deltas() -> void:
	var progress := CampaignTasks.add_campaign_task_progress({ "player:stock:tomatoes": 7 }, { "player:stock:tomatoes": 5, "player:stock:eggs": 0, "player:feed:cow": -3, "player:harvest:wheat": 2.5 })
	assert_eq(progress, { "player:stock:tomatoes": 8 })
	assert_eq(CampaignTasks.add_campaign_task_progress(null, { "player:stock:coffee": 20 }, "estacion"), { "player:stock:coffee": 12 })
