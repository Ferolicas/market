class_name CampaignExpansion
extends RefCounted
## Port of src/game/progression/CampaignExpansion.ts.

static func campaign_mastery_progress(franchise: Dictionary) -> float:
	var purchases = franchise.get("purchases")
	var progress = purchases.get("personalProgress") if purchases != null else null
	var tasks := JS.map(CampaignTasks.CAMPAIGN_TASK_IDS, func(id): return CampaignTasks.campaign_task_status(id, progress, franchise["id"]))
	var completed_purchases := JS.count(MartCampaign.OPENING_PURCHASES, func(item): return purchases != null and purchases["purchased"].has(item["id"]))
	var contracts := CampaignContracts.campaign_contracts(franchise)
	var task_sum := 0.0
	for task in tasks: task_sum += float(task["progress"]) / task["target"]
	return 100.0 * (completed_purchases + task_sum + JS.count(contracts, func(contract): return contract["completed"])) / (MartCampaign.OPENING_PURCHASES.size() + tasks.size() + contracts.size())

## Original progression across the existing locations, not reference levels.
## Every product chain and personal task must be mastered in the preceding store.
static func campaign_expansion_quote(state: Dictionary, franchise_id: String) -> Dictionary:
	var index := JS.find_index(Catalog.FRANCHISE_TEMPLATES, func(item): return item["id"] == franchise_id)
	var target = JS.find(state["franchises"], func(item): return item["id"] == franchise_id)
	var previous = null
	if index > 0:
		var previous_id: String = Catalog.FRANCHISE_TEMPLATES[index - 1]["id"]
		previous = JS.find(state["franchises"], func(item): return item["id"] == previous_id)
	var purchases = previous.get("purchases") if previous != null else null
	var missing_purchases := JS.filter(MartCampaign.OPENING_PURCHASES, func(item): return not (purchases != null and purchases["purchased"].has(item["id"])))
	var tasks := JS.map(CampaignTasks.CAMPAIGN_TASK_IDS, func(id): return CampaignTasks.campaign_task_status(id, purchases.get("personalProgress") if purchases != null else null, previous["id"] if previous != null else null))
	var contracts: Array = CampaignContracts.campaign_contracts(previous) if previous != null else []
	var previous_owned: bool = previous != null and bool(previous["owned"])
	var available: bool = target != null and not target["owned"] and previous_owned and purchases != null and missing_purchases.is_empty() \
		and JS.every(tasks, func(task): return task["completed"]) and JS.every(contracts, func(contract): return contract["completed"])
	var reason: String
	if not previous_owned: reason = "Abre primero el local anterior"
	elif not missing_purchases.is_empty(): reason = "Completa %d compras en %s" % [missing_purchases.size(), previous["name"]]
	elif JS.some(tasks, func(task): return not task["completed"]): reason = "Completa tu trabajo personal en %s" % previous["name"]
	elif JS.some(contracts, func(contract): return not contract["completed"]): reason = "Entrega los encargos personales de %s" % previous["name"]
	else: reason = "Supermercado anterior completado"
	return { "available": available, "previousName": previous["name"] if previous != null else null, "costMinor": target["purchaseCostMinor"] if target != null else 0,
		"missingPurchases": missing_purchases, "tasks": tasks, "contracts": contracts, "reason": reason }
