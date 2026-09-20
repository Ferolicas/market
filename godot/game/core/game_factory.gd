class_name GameFactory
extends RefCounted
## Exact initial-state constructors from src/game/engine.ts.
## Kept separate from action dispatch so every country can be compared as JSON.
const DEFAULT_AVATAR = {"body": "adult-man", "hair": "side-part", "hairColor": "#332b27", "skin": "#bd815f", "shirt": "#76aee5", "hat": "none"}

static func country_money_scale(country_code: String) -> float:
	return float(Catalog.COUNTRIES[country_code].startingCapitalMinor) / Catalog.COUNTRIES.ES.startingCapitalMinor

static func employee_hiring_quote(role: String, country_code: String) -> Dictionary:
	var salary_minor := JS.round(Catalog.ROLE_INFO[role].salaryMinor * country_money_scale(country_code))
	return {"salaryMinor": salary_minor, "signingCostMinor": salary_minor * 2}

static func missions_for_day(day: int, money_scale: float = 1, level: int = 1) -> Array:
	var scale := 1 + floori(day / 3.0)
	var activity: Dictionary = {
		"id": "d%d-%s" % [day, "produce" if level >= 5 else "harvest"],
		"label": ("Completa %d ciclos de producción" if level >= 5 else "Cosecha %d productos") % (2 + scale),
		"kind": "production" if level >= 5 else "harvest", "target": 2 + scale,
		"progress": 0, "rewardMinor": JS.round(19000 * scale * money_scale), "completed": false, "claimed": false,
	}
	return [
		{"id": "d%d-stock" % day, "label": "Repón %d productos" % (5 + scale * 2), "kind": "stock", "target": 5 + scale * 2, "progress": 0, "rewardMinor": JS.round(12000 * scale * money_scale), "completed": false, "claimed": false},
		{"id": "d%d-customers" % day, "label": "Atiende %d clientes" % (3 + scale), "kind": "customers", "target": 3 + scale, "progress": 0, "rewardMinor": JS.round(16000 * scale * money_scale), "completed": false, "claimed": false},
		activity,
	]

static func create_initial_game(country_code: String = "ES") -> Dictionary:
	var country: Dictionary = Catalog.COUNTRIES[country_code]
	var money_scale := country_money_scale(country_code)
	var franchises: Array = []
	for index in Catalog.FRANCHISE_TEMPLATES.size():
		var template: Dictionary = Catalog.FRANCHISE_TEMPLATES[index]
		var shelves := ProductRegistry.create_empty_inventory()
		shelves.merge({"milk": 8 if index == 0 else 0, "eggs": 6 if index == 0 else 0, "apples": 8 if index == 0 else 0}, true)
		var crops: Array = [StationSystem.create_crop("crop-tomato-1", "tomatoes", 0, 1, 1)]
		for entry in [["apple", "apples"], ["wheat", "wheat"], ["corn", "corn"], ["orange", "oranges"], ["coffee", "coffee"]]:
			var crop := StationSystem.create_empty_crop("crop-%s-1" % entry[0], entry[1])
			crop.status = "LOCKED"
			crops.append(crop)
		var machines: Array = []
		for entry in [["flour-mill-1", "flour"], ["bread-oven-1", "bread"], ["cheese-maker-1", "cheese"], ["juice-machine-1", "juice"], ["chicken-coop-1", "eggs"], ["cow-station-1", "milk"]]:
			var machine := StationSystem.create_machine(entry[0], entry[1])
			machine.status = "LOCKED"
			machines.append(machine)
		var franchise := template.duplicate(true)
		franchise.merge({
			"purchaseCostMinor": JS.round(template.purchaseCostMinor * money_scale), "owned": index == 0, "open": false,
			"licenseActive": index == 0, "licenseDaysLeft": 7 if index == 0 else 0,
			"expansionLevel": 1, "shelvesLevel": 1, "checkoutLevel": 1,
			"warehouse": ProductRegistry.create_empty_inventory(), "shelves": shelves,
			"machines": {"flourMillLevel": 1, "bakeryLevel": 1, "flourQueue": 0, "breadQueue": 0},
			"carry": {"capacity": 3, "items": {}}, "crops": crops, "productionMachines": machines,
			"buildProjects": [{"id": "level-2", "level": 2, "costMinor": JS.round(Levels.LEVELS[1].costMinor * money_scale), "contributedMinor": 0, "completed": false}],
			"checkoutTransactions": [], "registerCashMinor": [0, 0, 0], "returnsBin": ProductRegistry.create_empty_inventory(),
			"returnedCartCount": 6, "customers": [], "nextCustomerSequence": 1, "lastCustomerSpawnAt": -3000,
			"queueCustomerIds": [], "unlockedAreas": ["store-floor", "farm-tomato", "checkout-1"],
			"stationTiers": {"crop-tomato-1": 1, "shelves-1": 1, "checkout-1": 1}, "upgradeContributions": {},
			"playerSpeedTier": 1, "playerCapacityTier": 1, "storeRank": 1, "structureRevision": 1,
			"doorState": "CLOSED", "doorProgress": 0, "doorPlayerPresent": false, "doorEmptySince": null,
			"lightsOn": false, "employees": [], "revenueTodayMinor": 0, "expensesTodayMinor": 0,
			"customersToday": 0, "rating": 3.5,
		}, true)
		franchises.append(franchise)
	return {
		"schemaVersion": 4, "revision": 0, "countryCode": country_code, "currency": country.currency,
		"balanceMinor": country.startingCapitalMinor, "level": 1, "xp": 0, "reputation": 0, "day": 1,
		"minuteOfDay": BusinessDay.BUSINESS_DAY_OPEN_MINUTE, "currentFranchiseId": franchises[0].id,
		"avatar": DEFAULT_AVATAR.duplicate(true), "franchises": franchises, "missions": missions_for_day(1, money_scale, 1),
		"pendingOrders": [], "finances": {"grossRevenueMinor": 0, "costOfGoodsMinor": 0, "payrollMinor": 0, "operatingCostsMinor": 0, "taxesMinor": 0, "netProfitMinor": 0},
		"tutorialStep": 0, "progression": {"completedLevels": [], "counters": {}, "levelStartedCounters": {}, "playerActionCount": 0, "levelStartedPlayerActionCount": 0, "objectiveComplete": false, "lastUnlockAt": 0},
		"eventSequence": 0, "processedEventIds": [], "lastServerTime": 0, "simulationTimeMs": 0,
		"lastSavedAt": "1970-01-01T00:00:00.000Z",
	}

static func create_campaign_game(country_code: String = "ES") -> Dictionary:
	var state := create_initial_game(country_code)
	state.balanceMinor = 0
	state.missions = []
	for franchise in state.franchises:
		franchise.shelves = ProductRegistry.create_empty_inventory()
		franchise.buildProjects = []
		franchise.purchases = PurchaseState.create_purchase_state()
		franchise.unlockedAreas.append("purchase-campaign")
		for crop in franchise.crops: crop.baseYield = StationSystem.CAMPAIGN_BED_YIELD
	return state
