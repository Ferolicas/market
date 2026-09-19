class_name PurchaseState
extends RefCounted
## Port of src/game/progression/PurchaseState.ts.

## PurchaseState: { version: 1, inherited: OpeningPurchaseId[] (purchases inherited from an old save are never
##   charged again), purchased: OpeningPurchaseId[], contributions: Dictionary<OpeningPurchaseId, int>,
##   personalProgress?: CampaignTaskProgress, completedContracts?: CampaignContractId[] }
static func create_purchase_state() -> Dictionary:
	return { "version": 1, "inherited": [], "purchased": [], "contributions": {} }

const _MIGRATED_CROPS := { "crop-tomato-2": "tomato-2", "crop-tomato-3": "tomato-3", "crop-wheat-1": "wheat-1", "crop-apple-1": "apple-1", "crop-corn-1": "corn-1", "crop-orange-1": "orange-1", "crop-coffee-1": "coffee-supply-1" }
const _MIGRATED_MACHINES := { "flour-mill-1": "flour-mill-1", "bread-oven-1": "bread-oven-1", "chicken-coop-1": "chicken-1", "chicken-coop-2": "chicken-2", "cow-station-1": "cow-1", "cheese-maker-1": "cheese-maker-1", "juice-machine-1": "juice-machine-1" }

static func _grant(granted: Dictionary, id: String) -> void:
	if granted.has(id): return
	for prerequisite in MartCampaign.find_purchase(id)["requires"]: _grant(granted, prerequisite)
	granted[id] = true

static func migrate_purchases(franchise: Dictionary, legacy_level: int) -> Dictionary:
	var granted := {}
	for station in _MIGRATED_CROPS:
		if JS.some(franchise["crops"], func(crop): return crop["id"] == station and crop["status"] != "LOCKED"): _grant(granted, _MIGRATED_CROPS[station])
	for station in _MIGRATED_MACHINES:
		if JS.some(franchise["productionMachines"], func(machine): return machine["id"] == station and machine["status"] != "LOCKED"): _grant(granted, _MIGRATED_MACHINES[station])
	var farmers := JS.count(franchise["employees"], func(employee): return employee["role"] == "farmer")
	if farmers >= 1: _grant(granted, "farmer-1")
	if farmers >= 2: _grant(granted, "farmer-2")
	if farmers >= 3: _grant(granted, "farmer-3")
	if franchise["carry"]["capacity"] >= 4: _grant(granted, "player-2")
	if legacy_level >= 9: _grant(granted, "coffee-supply-1")
	for pair in [["chicken-coop-1", "chicken-1"], ["cow-station-1", "cow-1"]]:
		var machine = JS.find(franchise["productionMachines"], func(candidate): return candidate["id"] == pair[0] and candidate["status"] != "LOCKED")
		if machine != null and machine["tier"] >= 2: _grant(granted, "%s-tier-2" % pair[1])
		if machine != null and machine["tier"] >= 3: _grant(granted, "%s-tier-3" % pair[1])
	var purchased := JS.map(JS.filter(MartCampaign.OPENING_PURCHASES, func(purchase): return granted.has(purchase["id"])), func(purchase): return purchase["id"])
	return { "version": 1, "inherited": purchased.duplicate(), "purchased": purchased, "contributions": {} }

static func purchase_quote(state: Dictionary, id: Variant, country: String) -> Dictionary:
	var definition = MartCampaign.find_purchase(id)
	var cost_minor = MartCampaign.opening_purchase_cost(id, country)
	var purchased: Array = state["purchased"]
	var completed: bool = purchased.has(id)
	var contributed_minor: int = JS.get_or(state["contributions"], id, 0)
	var tasks := CampaignTasks.purchase_tasks(id if id is String else "", state.get("personalProgress"))
	var dependencies_met: bool = definition != null and JS.every(definition["requires"], func(dependency): return purchased.has(dependency))
	var remaining
	if completed: remaining = 0
	elif cost_minor == null: remaining = null
	else: remaining = maxi(0, cost_minor - contributed_minor)
	return { "id": id, "label": definition["label"] if definition != null else "Compra desconocida", "costMinor": cost_minor, "contributedMinor": contributed_minor, "completed": completed,
		"tasks": tasks, "dependenciesMet": dependencies_met,
		"available": definition != null and not completed and cost_minor != null and dependencies_met and JS.every(tasks, func(task): return task["completed"]),
		"remainingMinor": remaining }

## A purchase is paid by standing on its marker: the whole price flows in
## PURCHASE_CONTRIBUTION_FILL_MS whatever the amount (a quarter per second),
## one pulse every PURCHASE_CONTRIBUTION_PULSE_MS, so 1 000 € pays 250 €/s.
const PURCHASE_CONTRIBUTION_FILL_MS := 4000
const PURCHASE_CONTRIBUTION_PULSE_MS := 200

static func purchase_contribution_pulse_minor(cost_minor: Variant) -> int:
	if not JS.is_finite_number(cost_minor) or cost_minor <= 0: return 0
	return maxi(1, JS.ceil(float(cost_minor) * PURCHASE_CONTRIBUTION_PULSE_MS / PURCHASE_CONTRIBUTION_FILL_MS))

## Returns { state, spentMinor, completedNow }.
static func contribute_purchase(state: Dictionary, id: Variant, country: String, wallet_minor: Variant, requested_minor: Variant) -> Dictionary:
	var quote := purchase_quote(state, id, country)
	if not quote["available"] or quote["remainingMinor"] == null or not JS.is_safe_integer(requested_minor) or requested_minor <= 0 \
		or not JS.is_safe_integer(wallet_minor) or wallet_minor < 0: return { "state": state, "spentMinor": 0, "completedNow": false }
	var spent_minor: int = JS.min_of([int(wallet_minor), int(requested_minor), quote["remainingMinor"]])
	if spent_minor == 0: return { "state": state, "spentMinor": spent_minor, "completedNow": false }
	var total: int = quote["contributedMinor"] + spent_minor
	var completed_now: bool = total == quote["costMinor"]
	var purchased: Array = state["purchased"].duplicate()
	if completed_now: purchased.append(id)
	return { "state": JS.spread(state, { "contributions": JS.spread(state["contributions"], { id: total }), "purchased": purchased }), "spentMinor": spent_minor, "completedNow": completed_now }
