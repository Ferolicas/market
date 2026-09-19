extends TestCase
## Port of src/game/economy/CampaignPrices.test.ts (engine-free case).
## "charges the level price at the till" lives in test_campaign_prices_engine.gd.

func test_compounds_three_percent_per_level_from_the_base_price_at_level_one() -> void:
	assert_eq(CampaignLevels.CAMPAIGN_PRICE_GROWTH_PER_LEVEL, 0.03)
	assert_eq(CampaignLevels.campaign_price_multiplier(1), 1)
	assert_near(CampaignLevels.campaign_price_multiplier(2), 1.03)
	assert_near(CampaignLevels.campaign_price_multiplier(7), pow(1.03, 6))
	assert_near(CampaignLevels.campaign_price_multiplier(30), pow(1.03, 29))
	assert_eq(CampaignLevels.campaign_price_multiplier(0), 1)
	assert_eq(CampaignLevels.campaign_price_multiplier(99), CampaignLevels.campaign_price_multiplier(30))
