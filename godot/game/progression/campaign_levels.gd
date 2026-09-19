class_name CampaignLevels
extends RefCounted
## Port of src/game/progression/CampaignLevels.ts.

## Existing purchase graph supplies levels 2–28; personal mastery supplies 29–30.
## No XP, idle time or separate level payment can substitute these requirements.
static func campaign_level(franchise: Dictionary) -> int:
	var purchases = franchise.get("purchases")
	if purchases == null: return 1
	var purchased: Array = purchases["purchased"]
	var bought := JS.count(MartCampaign.OPENING_PURCHASES, func(item): return purchased.has(item["id"]))
	if bought < MartCampaign.OPENING_PURCHASES.size(): return 1 + bought
	if not JS.every(CampaignTasks.CAMPAIGN_TASK_IDS, func(id): return CampaignTasks.campaign_task_status(id, purchases.get("personalProgress"), franchise["id"])["completed"]): return 28
	return 30 if JS.every(CampaignContracts.campaign_contracts(franchise), func(contract): return contract["completed"]) else 29

## Sale prices grow 3 % per campaign level, compounding: the same unit sells
## for more as the store unlocks. Level 1 sells at the base price.
const CAMPAIGN_PRICE_GROWTH_PER_LEVEL := 0.03

static func campaign_price_multiplier(level: Variant) -> float:
	var step: int = maxi(0, mini(30, JS.floor(float(level)) if JS.is_finite_number(level) else 1) - 1)
	return pow(1.0 + CAMPAIGN_PRICE_GROWTH_PER_LEVEL, step)

static func campaign_global_level(state: Dictionary) -> int:
	var levels := [1]
	for item in state["franchises"]:
		if item["owned"]: levels.append(campaign_level(item))
	return JS.max_of(levels)

## Levels that hand the store a dedicated cashier, on top of the purchases.
## Authored by the owner: the first till gets staffed early, the second
## cashier opens the second till and the third opens the third one.
const CASHIER_UNLOCK_LEVELS := [5, 10, 20]

static func campaign_cashier_slots(level: int) -> int:
	return JS.count(CASHIER_UNLOCK_LEVELS, func(threshold): return level >= threshold)

## Purchases that each bring one worker of a role, authored by the owner so
## the finished store staffs 8 farmer-stockers, 3 feeders and 5 operators
## (plus the 3 cashiers the levels grant): the three farmer desks, the second
## farm and every new crop bring a farmer; every pen brings its feeder; every
## machine brings its operator.
const CAMPAIGN_STAFF_PURCHASES := {
	"farmer": ["farmer-1", "farmer-2", "farmer-3", "expansion-1", "wheat-1", "corn-1", "apple-1", "orange-1"],
	"feeder": ["chicken-1", "cow-1", "chicken-2"],
	"operator": ["flour-mill-1", "bread-oven-1", "cheese-maker-1", "juice-machine-1", "corn-canner-1"],
}

## Total slots, including staff granted by purchases and by level rewards.
static func campaign_employee_limit(franchise: Dictionary, role: String) -> int:
	var purchases = franchise.get("purchases")
	var owns := func(id: String) -> bool:
		return purchases != null and JS.some(purchases["purchased"], func(item): return item == id)
	match role:
		"cashier": return campaign_cashier_slots(campaign_level(franchise))
		"farmer": return JS.count(CAMPAIGN_STAFF_PURCHASES["farmer"], owns)
		"feeder": return JS.count(CAMPAIGN_STAFF_PURCHASES["feeder"], owns)
		"operator": return JS.count(CAMPAIGN_STAFF_PURCHASES["operator"], owns)
		# Stocking is the granjero-reponedor's own job and building is automatic,
		# so the campaign no longer opens these desks.
		"stocker": return 0
		"builder": return 0
		"manager": return 0
	return 0
