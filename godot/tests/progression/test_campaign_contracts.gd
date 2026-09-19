extends TestCase
## Port of src/game/progression/CampaignContracts.test.ts (engine-free case).
## The cases needing MarketEngine live in test_campaign_contracts_engine.gd.

func test_defines_eighteen_sequential_three_unit_orders_covering_the_full_catalog() -> void:
	assert_eq(JS.unique(JS.map(CampaignContracts.CAMPAIGN_CONTRACTS, func(contract): return contract["id"])).size(), 18)
	assert_eq(JS.unique(JS.flat_map(CampaignContracts.CAMPAIGN_CONTRACTS, func(contract): return contract["products"])).size(), ProductRegistry.PRODUCT_IDS.size())
	for contract in CampaignContracts.CAMPAIGN_CONTRACTS:
		assert_eq(contract["products"].size(), 3)
		assert_eq(JS.unique(contract["products"]).size(), 3)

func test_sequences_orders_by_location_and_marks_ready_only_from_personal_carry() -> void:
	var franchise := { "id": "barrio", "purchases": PurchaseState.create_purchase_state(), "carry": MarketTypes.create_carry_state() }
	franchise["purchases"]["purchased"] = JS.map(MartCampaign.OPENING_PURCHASES, func(item): return item["id"])
	var contracts := CampaignContracts.campaign_contracts(franchise)
	assert_eq(JS.map(contracts, func(contract): return contract["id"]), ["barrio-huerta", "barrio-molienda", "barrio-despensa"])
	assert_eq(JS.map(contracts, func(contract): return contract["previousDone"]), [true, false, false])
	assert_true(JS.every(contracts, func(contract): return contract["unlocked"] and not contract["completed"] and not contract["ready"]))
	franchise["carry"]["items"] = { "tomatoes": 1, "eggs": 1, "corn": 1 }
	assert_true(CampaignContracts.campaign_contracts(franchise)[0]["ready"])
	franchise["purchases"]["completedContracts"] = ["barrio-huerta"]
	contracts = CampaignContracts.campaign_contracts(franchise)
	assert_true(contracts[0]["completed"] and not contracts[0]["ready"] and contracts[1]["previousDone"])
	franchise["purchases"]["purchased"] = []
	assert_false(CampaignContracts.campaign_contracts(franchise)[0]["unlocked"])
	assert_eq(CampaignContracts.campaign_contracts({ "id": "barrio", "carry": MarketTypes.create_carry_state() }), [])
