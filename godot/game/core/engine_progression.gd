class_name EngineProgression
extends RefCounted
## State mutations ported from src/game/engine.ts; callers own the cloned state.

const CAMPAIGN_CROP_PURCHASES = {
	"tomato-2": ["crop-tomato-2", "tomatoes", "farm-tomato-2"],
	"tomato-3": ["crop-tomato-3", "tomatoes", "farm-tomato-3"],
	"wheat-1": ["crop-wheat-1", "wheat", "farm-wheat"],
	"apple-1": ["crop-apple-1", "apples", "farm-apple"],
	"corn-1": ["crop-corn-1", "corn", "farm-corn"],
	"orange-1": ["crop-orange-1", "oranges", "farm-orange"],
	"coffee-supply-1": ["crop-coffee-1", "coffee", "farm-coffee"],
}
const MACHINE_PURCHASES = {
	"corn-canner-1": ["corn-canner-1", "cannedCorn", "corn-canner"],
	"flour-mill-1": ["flour-mill-1", "flour", "flour-mill"],
	"bread-oven-1": ["bread-oven-1", "bread", "bread-oven"],
	"cheese-maker-1": ["cheese-maker-1", "cheese", "cheese-maker"],
	"juice-machine-1": ["juice-machine-1", "juice", "juice-machine"],
	"chicken-1": ["chicken-coop-1", "eggs", "chicken-coop"],
	"chicken-2": ["chicken-coop-2", "eggs", "chicken-coop-2"],
	"cow-1": ["cow-station-1", "milk", "cow-station"],
}
const COUNTS_AS_PLAYER_PROGRESS = ["DELIVER_CONTRACT", "CONTRIBUTE_PURCHASE", "TEND_CROP", "HARVEST", "LOAD_FLOUR_MILL", "BAKE_BREAD", "OPERATE_MACHINE", "PICKUP_WAREHOUSE", "RETURN_TO_WAREHOUSE", "STOCK", "CHECKOUT", "COLLECT_REGISTER", "ORDER", "CONTRIBUTE_UPGRADE"]

static func current_franchise(state: Dictionary) -> Dictionary:
	for franchise in state.franchises:
		if franchise.id == state.currentFranchiseId: return franchise
	return state.franchises[0]

static func find_id(items: Array, id: String) -> Variant:
	for item in items:
		if item.id == id: return item
	return null

static func unlock_area(franchise: Dictionary, id: String) -> void:
	if id not in franchise.unlockedAreas: franchise.unlockedAreas.append(id)

static func ensure_tier(franchise: Dictionary, id: String) -> void:
	if franchise.stationTiers.get(id) == null: franchise.stationTiers[id] = 1

static func unlock_crop(franchise: Dictionary, id: String, now: float, game_level: int) -> void:
	var crop = find_id(franchise.crops, id)
	if crop != null and crop.status == "LOCKED":
		crop.merge(StationSystem.create_crop(crop.id, crop.productId, now, crop.tier, game_level, crop.get("baseYield")), true)

static func unlock_machine(franchise: Dictionary, id: String) -> void:
	var machine = find_id(franchise.productionMachines, id)
	if machine != null and machine.status == "LOCKED": machine.status = "WAITING_INPUT"

static func carry_capacity_tier(capacity: Variant) -> int:
	var safe_capacity: int = maxi(1, floori(capacity)) if JS.is_finite_number(capacity) else CarrySystem.CAPACITY_TIERS[0]
	var tier := 1
	for index in range(1, CarrySystem.CAPACITY_TIERS.size()):
		if safe_capacity < CarrySystem.CAPACITY_TIERS[index]: break
		tier = index + 1
	return tier

static func create_employee_runtime(role: String, index: int, now: float) -> Dictionary:
	var homes := {"farmer": FarmLayout.FARM_WORKER_HOME, "feeder": [FarmLayout.FARM_WORKER_HOME[0] + 1.4, FarmLayout.FARM_WORKER_HOME[1]], "operator": [-4.8, -0.9], "stocker": [0, -2.2], "cashier": [4.7, 2.2], "builder": [2.9, -4.5], "manager": [5.4, -3.6]}
	var home: Array = homes[role]
	return {"state": "IDLE", "assignedProduct": null, "assignedStationId": null, "carry": {"capacity": 2, "items": {}}, "x": home[0] + index * 0.12, "z": home[1], "targetX": home[0], "targetZ": home[1], "path": [], "pathIndex": 0, "speed": 1.5, "currentSpeed": 0, "stateSince": now}

static func employee(franchise: Dictionary, role: String, country: String, now: float, id: String, hat_offset: int = 0) -> Dictionary:
	var index: int = franchise.employees.size()
	return {"id": id, "name": Catalog.EMPLOYEE_NAMES[index % Catalog.EMPLOYEE_NAMES.size()], "role": role, "level": 1, "salaryMinor": GameFactory.employee_hiring_quote(role, country).salaryMinor, "energy": 100, "hat": Catalog.HATS[(index + hat_offset) % Catalog.HATS.size()].id, "runtime": create_employee_runtime(role, index, now)}

static func employee_count(franchise: Dictionary, role: String) -> int:
	var count := 0
	for worker in franchise.employees:
		if worker.role == role: count += 1
	return count

static func hire_unlocked_employee(franchise: Dictionary, role: String, country: String, now: float) -> void:
	if employee_count(franchise, role) > 0: return
	franchise.employees.append(employee(franchise, role, country, now, "unlock-%s-%d" % [role, franchise.employees.size()]))

static func ensure_checkouts_for_cashiers(franchise: Dictionary) -> void:
	var cashiers := employee_count(franchise, "cashier")
	for lane in CheckoutLayout.CHECKOUT_LANE_IDS:
		if lane == 0 or cashiers < lane + 1: continue
		var area := CheckoutLayout.checkout_area_for_lane(lane)
		if area in franchise.unlockedAreas: continue
		unlock_area(franchise, area)
		ensure_tier(franchise, area)
		franchise.structureRevision += 1

static func sanitize_campaign_purchases(franchise: Dictionary) -> void:
	if franchise.get("purchases") == null: return
	var purchases: Dictionary = franchise.purchases
	var known: Array = MartCampaign.OPENING_PURCHASES.map(func(purchase): return purchase.id)
	purchases.purchased = purchases.purchased.filter(func(id): return id in known)
	purchases.inherited = JS.get_or(purchases, "inherited", []).filter(func(id): return id in known)
	var contributions: Dictionary = JS.get_or(purchases, "contributions", {}).duplicate()
	for id in contributions.keys():
		if id not in known: contributions.erase(id)
	purchases.contributions = contributions
	if purchases.get("personalProgress") != null:
		purchases.personalProgress = purchases.personalProgress.duplicate()
		for id in purchases.personalProgress.keys():
			if id not in CampaignTasks.CAMPAIGN_TASK_IDS: purchases.personalProgress.erase(id)

static func trim_campaign_staff(franchise: Dictionary) -> void:
	if franchise.get("purchases") == null: return
	var kept: Array = []
	var counts := {}
	for worker in franchise.employees:
		var count: int = counts.get(worker.role, 0)
		if count >= CampaignLevels.campaign_employee_limit(franchise, worker.role): continue
		counts[worker.role] = count + 1
		kept.append(worker)
	if kept.size() != franchise.employees.size(): franchise.employees = kept

static func sync_campaign_staff(state: Dictionary, franchise: Dictionary) -> void:
	if franchise.get("purchases") == null or not franchise.owned: return
	for role in ["cashier", "farmer", "feeder", "operator"]:
		var slots := CampaignLevels.campaign_employee_limit(franchise, role)
		while employee_count(franchise, role) < slots:
			franchise.employees.append(employee(franchise, role, state.countryCode, state.simulationTimeMs, "campaign-%s-%d-%d" % [role, slots, franchise.employees.size()]))
	ensure_checkouts_for_cashiers(franchise)

static func sync_campaign_progression(state: Dictionary) -> void:
	state.level = CampaignLevels.campaign_global_level(state)
	state.progression.completedLevels = range(1, state.level)
	state.progression.objectiveComplete = state.level == 30

static func grant_campaign_crop(state: Dictionary, franchise: Dictionary, station: String, product: String, zone: String) -> bool:
	var changed := false
	if zone not in franchise.unlockedAreas:
		unlock_area(franchise, zone)
		changed = true
	var crop = find_id(franchise.crops, station)
	if crop == null:
		crop = StationSystem.create_crop(station, product, state.simulationTimeMs)
		franchise.crops.append(crop)
		changed = true
	if crop.status == "LOCKED":
		unlock_crop(franchise, station, state.simulationTimeMs, 1)
		changed = true
	crop.baseYield = StationSystem.CAMPAIGN_BED_YIELD
	ensure_tier(franchise, station)
	return changed

static func sync_campaign_crops(state: Dictionary, franchise: Dictionary) -> void:
	if franchise.get("purchases") == null or not franchise.owned: return
	for id in franchise.purchases.purchased:
		if id not in CAMPAIGN_CROP_PURCHASES: continue
		var grant: Array = CAMPAIGN_CROP_PURCHASES[id]
		if grant_campaign_crop(state, franchise, grant[0], grant[1], grant[2]): franchise.structureRevision += 1

static func apply_purchase_content(state: Dictionary, franchise: Dictionary, id: String) -> void:
	if id in CAMPAIGN_CROP_PURCHASES:
		if id == "coffee-supply-1": unlock_area(franchise, "coffee-supply")
		var grant: Array = CAMPAIGN_CROP_PURCHASES[id]
		grant_campaign_crop(state, franchise, grant[0], grant[1], grant[2])
	elif id in MACHINE_PURCHASES:
		var grant: Array = MACHINE_PURCHASES[id]
		unlock_area(franchise, grant[2])
		if find_id(franchise.productionMachines, grant[0]) == null: franchise.productionMachines.append(StationSystem.create_machine(grant[0], grant[1]))
		unlock_machine(franchise, grant[0])
		ensure_tier(franchise, grant[0])
	else:
		match id:
			"farmer-1", "farmer-2", "farmer-3": pass
			"player-2":
				franchise.carry.capacity = maxi(4, franchise.carry.capacity)
				franchise.playerSpeedTier = maxi(2, franchise.playerSpeedTier)
			"egg-display-1": unlock_area(franchise, "egg-display")
			"dairy-display-1": unlock_area(franchise, "dairy-display")
			"preserves-supply-1": unlock_area(franchise, "preserves-supply")
			"expansion-1":
				unlock_area(franchise, "expansion-side")
				franchise.expansionLevel = maxi(2, franchise.expansionLevel)
				franchise.storeRank = maxi(2, franchise.storeRank)
			_:
				var station := "cow-station-1" if id.begins_with("cow") else "chicken-coop-1"
				var target = find_id(franchise.productionMachines, station)
				var tier := 3 if id.ends_with("-3") else 2
				if target != null: target.tier = maxi(target.tier, tier)
				franchise.stationTiers[station] = maxi(franchise.stationTiers.get(station, 1), tier)
	sync_campaign_staff(state, franchise)
	franchise.structureRevision += 1

static func record_domain(state: Dictionary, counter: String, amount: float) -> void:
	state.progression.counters[counter] = state.progression.counters.get(counter, 0) + amount

static func gain(state: Dictionary, xp: int, mission_kind: String, amount: int) -> void:
	state.xp += xp
	for mission in state.missions:
		if mission.kind != mission_kind or mission.completed: continue
		mission.progress = mini(mission.target, mission.progress + amount)
		mission.completed = mission.progress >= mission.target

static func update_machine_with_progress(state: Dictionary, machine: Dictionary) -> Dictionary:
	var updated := StationSystem.update_machine(machine, state.simulationTimeMs)
	var produced: int = maxi(0, updated.output - machine.output)
	if produced > 0:
		record_domain(state, "production:%s" % updated.productId, produced)
		record_domain(state, "production:all", produced)
		gain(state, 24 * produced, "production", produced)
	return updated

static func attribute_player_action(state: Dictionary, action: Dictionary, before: Dictionary) -> void:
	record_domain(state, "player:action:%s" % action.type, 1)
	for id in state.progression.counters.keys():
		if id.begins_with("player:"): continue
		var delta: float = state.progression.counters[id] - before.get(id, 0)
		if delta > 0: record_domain(state, "player:%s" % id, delta)
	match action.type:
		"LOAD_FLOUR_MILL": record_domain(state, "player:machine:flour-mill-1", 1)
		"BAKE_BREAD": record_domain(state, "player:machine:bread-oven-1", 1)
		"OPERATE_MACHINE": record_domain(state, "player:machine:%s" % action.machineId, 1)

static func ensure_next_build_project(state: Dictionary, franchise: Dictionary) -> void:
	if franchise.get("purchases") != null:
		franchise.buildProjects = []
		return
	if state.level >= 30: return
	for project in franchise.buildProjects:
		if project.level == state.level + 1: return
	franchise.buildProjects.append({"id": "level-%d" % (state.level + 1), "level": state.level + 1, "costMinor": JS.round(Levels.LEVELS[state.level].costMinor * GameFactory.country_money_scale(state.countryCode)), "contributedMinor": 0, "completed": false})

static func normalize_build_project(project: Dictionary, country: String) -> Dictionary:
	var expected := JS.round(Levels.LEVELS[project.level - 1].costMinor * GameFactory.country_money_scale(country))
	var previous_cost: float = project.costMinor if JS.is_safe_integer(project.costMinor) and project.costMinor > 0 else expected
	var previous_contribution: float = maxf(0, project.contributedMinor) if JS.is_safe_integer(project.contributedMinor) else 0
	var ratio: float = 1 if project.completed else minf(1, previous_contribution / maxf(1, previous_cost))
	var contribution: int = expected if project.completed else mini(expected, JS.round(expected * ratio))
	var result := project.duplicate(true)
	result.merge({"id": "level-%d" % project.level, "costMinor": expected, "contributedMinor": contribution, "completed": contribution >= expected}, true)
	return result

static func normalize_register_cash(value: Variant) -> Array:
	var lanes: Array = value if value is Array else []
	var result: Array = []
	for lane in CheckoutLayout.CHECKOUT_LANE_IDS:
		result.append(lanes[lane] if lane < lanes.size() and lanes[lane] != null else 0)
	return result

static func apply_level_unlock(state: Dictionary, franchise: Dictionary, level: int) -> void:
	if level == 2:
		if find_id(franchise.crops, "crop-tomato-2") == null: franchise.crops.append(StationSystem.create_crop("crop-tomato-2", "tomatoes", state.simulationTimeMs, 1, level))
		ensure_tier(franchise, "crop-tomato-2")
	# These legacy orchards did not exist in every older save.
	var added_crops := {2: ["apple", "apples"], 9: ["coffee", "coffee"], 20: ["orange", "oranges"]}
	# Preserve the original order of mutations (including employee grants).
	if level == 9: hire_unlocked_employee(franchise, "stocker", state.countryCode, state.simulationTimeMs)
	if level == 20:
		franchise.storeRank = maxi(3, franchise.storeRank)
		if "expansion-rear" not in franchise.unlockedAreas: franchise.structureRevision += 1
		unlock_area(franchise, "expansion-rear")
	if level in added_crops:
		var entry: Array = added_crops[level]
		var id: String = "crop-%s-1" % entry[0]
		unlock_area(franchise, "farm-%s" % entry[0])
		if find_id(franchise.crops, id) == null:
			var crop := StationSystem.create_empty_crop(id, entry[1])
			crop.status = "LOCKED"
			franchise.crops.append(crop)
		unlock_crop(franchise, id, state.simulationTimeMs, level)
		ensure_tier(franchise, id)
	var crop_unlocks := {4: ["farm-wheat", "crop-wheat-1"], 11: ["farm-corn", "crop-corn-1"]}
	if level in crop_unlocks:
		var entry: Array = crop_unlocks[level]
		unlock_area(franchise, entry[0])
		unlock_crop(franchise, entry[1], state.simulationTimeMs, level)
		ensure_tier(franchise, entry[1])
	var machine_unlocks := {5: ["flour-mill", "flour-mill-1"], 6: ["bread-oven", "bread-oven-1"], 8: ["chicken-coop", "chicken-coop-1"], 13: ["cow-station", "cow-station-1"], 16: ["cheese-maker", "cheese-maker-1"], 21: ["juice-machine", "juice-machine-1"]}
	if level in machine_unlocks:
		var entry: Array = machine_unlocks[level]
		unlock_area(franchise, entry[0])
		unlock_machine(franchise, entry[1])
		ensure_tier(franchise, entry[1])
	match level:
		3, 15, 24:
			franchise.carry.capacity = maxi({3: 5, 15: 8, 24: 12}[level], franchise.carry.capacity)
			franchise.playerCapacityTier = carry_capacity_tier(franchise.carry.capacity)
			if level == 3: franchise.playerSpeedTier = maxi(2, franchise.playerSpeedTier)
			if level == 24:
				franchise.stationTiers["shelves-1"] = maxi(3, franchise.stationTiers.get("shelves-1", franchise.shelvesLevel))
				franchise.shelvesLevel = maxi(3, franchise.shelvesLevel)
		7:
			franchise.checkoutLevel = maxi(2, franchise.checkoutLevel)
			franchise.stationTiers["checkout-1"] = maxi(2, franchise.stationTiers.get("checkout-1", 1))
		10:
			franchise.storeRank = maxi(2, franchise.storeRank)
			if "expansion-side" not in franchise.unlockedAreas: franchise.structureRevision += 1
			unlock_area(franchise, "expansion-side")
		12: franchise.playerSpeedTier = maxi(2, franchise.playerSpeedTier)
		14: hire_unlocked_employee(franchise, "cashier", state.countryCode, state.simulationTimeMs)
		17:
			unlock_area(franchise, "checkout-2")
			ensure_tier(franchise, "checkout-2")
		18:
			unlock_area(franchise, "stockroom-rack")
			unlock_area(franchise, "delivery-dock")
		22: hire_unlocked_employee(franchise, "farmer", state.countryCode, state.simulationTimeMs)
		23: unlock_area(franchise, "facade-premium")
		26: hire_unlocked_employee(franchise, "operator", state.countryCode, state.simulationTimeMs)
		27:
			if "expansion-third" not in franchise.unlockedAreas: franchise.structureRevision += 1
			unlock_area(franchise, "expansion-third")
			unlock_area(franchise, "endcap-display")
		28: unlock_area(franchise, "equipment-premium")
		30:
			franchise.storeRank = maxi(4, franchise.storeRank)
			unlock_area(franchise, "franchise-unlocked")

static func synchronize_franchise_progression(state: Dictionary, franchise: Dictionary) -> void:
	for level in range(2, mini(30, state.level) + 1): apply_level_unlock(state, franchise, level)
	franchise.playerCapacityTier = carry_capacity_tier(franchise.carry.capacity)
	ensure_next_build_project(state, franchise)

static func normalize_level(state: Dictionary) -> void:
	if current_franchise(state).get("purchases") != null:
		for franchise in state.franchises: sync_campaign_staff(state, franchise)
		sync_campaign_progression(state)
		return
	state.progression.objectiveComplete = Objectives.level_objective_satisfied(state.level, state)
	var franchise := current_franchise(state)
	while state.level < 30:
		var project: Variant = null
		for candidate in franchise.buildProjects:
			if candidate.level == state.level + 1:
				project = candidate
				break
		if not state.progression.objectiveComplete or project == null or not project.completed: break
		state.progression.completedLevels.append(state.level)
		state.level += 1
		state.progression.lastUnlockAt = state.simulationTimeMs
		state.progression.levelStartedCounters = state.progression.counters.duplicate()
		state.progression.levelStartedPlayerActionCount = state.progression.playerActionCount
		for owned in state.franchises:
			if not owned.owned: continue
			apply_level_unlock(state, owned, state.level)
			ensure_next_build_project(state, owned)
		state.progression.objectiveComplete = Objectives.level_objective_satisfied(state.level, state)

static func can_hire_employee(state: Dictionary, role: String) -> bool:
	var franchise := current_franchise(state)
	if franchise.get("purchases") == null: return state.level >= Catalog.ROLE_INFO[role].unlockLevel
	return employee_count(franchise, role) < CampaignLevels.campaign_employee_limit(franchise, role)

static func station_upgrade_label(franchise: Dictionary, id: String) -> String:
	var labels := {"shelves-1": "Expositores de venta", "checkout-1": "Caja principal", "checkout-2": "Caja secundaria", "checkout-3": "Tercera caja", "flour-mill-1": "Molino de harina", "bread-oven-1": "Horno de pan", "chicken-coop-1": "Gallinero", "cow-station-1": "Estación de leche", "cheese-maker-1": "Quesera", "juice-machine-1": "Máquina de zumo", "corn-canner-1": "Enlatadora de maíz"}
	if id in labels: return labels[id]
	var crop = find_id(franchise.crops, id)
	if crop != null: return "Bancal de %s" % Catalog.PRODUCTS[crop.productId].name.to_lower()
	var machine = find_id(franchise.productionMachines, id)
	if machine != null: return "Estación de %s" % Catalog.PRODUCTS[machine.productId].name.to_lower()
	return "Estación prioritaria"

static func upgrade_target(state: Dictionary, franchise: Dictionary, upgrade: String) -> Variant:
	if upgrade == "station":
		var entries: Array = []
		for id in franchise.stationTiers:
			var tier: int = franchise.stationTiers[id]
			if tier >= 5: continue
			if franchise.get("purchases") != null:
				var crop = find_id(franchise.crops, id)
				var machine = find_id(franchise.productionMachines, id)
				if (crop != null and crop.status == "LOCKED") or (machine != null and machine.status == "LOCKED"): continue
				if id == "chicken-coop-1" and "chicken-1-tier-3" not in franchise.purchases.purchased: continue
				if id == "cow-station-1" and "cow-1-tier-3" not in franchise.purchases.purchased: continue
			entries.append([id, tier])
		entries.sort_custom(func(a, b): return a[0] < b[0] if a[1] == b[1] else a[1] < b[1])
		if entries.is_empty(): return null
		return {"kind": "station", "id": entries[0][0], "label": station_upgrade_label(franchise, entries[0][0]), "currentTier": entries[0][1]}
	var player_available: bool = "player-2" in franchise.purchases.purchased if franchise.get("purchases") != null else state.level >= 3
	if upgrade == "player-speed":
		return {"kind": upgrade, "id": upgrade, "label": "Velocidad del vendedor", "currentTier": franchise.playerSpeedTier} if player_available and franchise.playerSpeedTier < 5 else null
	if upgrade == "player-capacity":
		var tier := carry_capacity_tier(franchise.carry.capacity)
		return {"kind": upgrade, "id": upgrade, "label": "Capacidad de carga", "currentTier": tier} if player_available and tier < CarrySystem.CAPACITY_TIERS.size() else null
	for role in Catalog.ROLE_INFO:
		if can_hire_employee(state, role) and employee_count(franchise, role) == 0:
			return {"kind": "hire", "id": role, "label": "Contratación: %s" % Catalog.ROLE_INFO[role].name, "currentTier": 0}
	var employees: Array = franchise.employees.filter(func(worker): return worker.level < 5)
	employees.sort_custom(func(a, b): return a.id < b.id if a.level == b.level else a.level < b.level)
	if employees.is_empty(): return null
	return {"kind": "employee", "id": employees[0].id, "label": "Formación de %s" % employees[0].name, "currentTier": employees[0].level}

static func upgrade_cost_minor(state: Dictionary, tier: int, upgrade: String) -> int:
	var base: int = {"station": 5000, "player-speed": 7500, "player-capacity": 6500, "employee": 8000}[upgrade]
	return JS.round(base * pow(maxi(1, tier), 1.55) * GameFactory.country_money_scale(state.countryCode))

static func upgrade_quote(state: Dictionary, upgrade: String) -> Variant:
	var franchise := current_franchise(state)
	var target = upgrade_target(state, franchise, upgrade)
	if target == null: return null
	var cost := upgrade_cost_minor(state, target.currentTier, upgrade)
	var key := "%s:%s:%d" % [upgrade, target.id, target.currentTier + 1]
	var contributed: int = franchise.upgradeContributions.get(key, 0)
	return {"label": target.label, "currentTier": target.currentTier, "nextTier": mini(5, target.currentTier + 1), "costMinor": cost, "contributedMinor": contributed, "remainingMinor": maxi(0, cost - contributed)}

static func set_station_tier(franchise: Dictionary, id: String, tier: int) -> void:
	franchise.stationTiers[id] = tier
	var crop = find_id(franchise.crops, id)
	if crop != null: crop.tier = tier
	var machine = find_id(franchise.productionMachines, id)
	if machine != null:
		machine.tier = tier
		machine.outputCapacity = maxi(machine.output, JS.round(Products.PRODUCT_CONFIG.get(machine.productId, {}).get("outputCapacity", 8) * Levels.station_tier_modifiers(tier).capacity))

static func apply_roster_upgrade(franchise: Dictionary, entry: Dictionary) -> void:
	if entry.kind == "player":
		var base := RosterUpgrades.roster_player_base(franchise)
		var step: int = entry.step + 1
		franchise.playerSpeedTier = base.speedTier + step
		franchise.carry.capacity = EmployeeStats.employee_carry_capacity(step + 1)
		franchise.playerCapacityTier = carry_capacity_tier(franchise.carry.capacity)
		return
	if entry.kind == "employee":
		var worker = find_id(franchise.employees, entry.id.trim_prefix("employee:"))
		if worker != null: worker.level = entry.step + 2
		return
	var id: String = entry.id.trim_prefix("station:")
	set_station_tier(franchise, id, RosterUpgrades.roster_base_tier(franchise, id) + entry.step + 1)

static func apply_upgrade_target(state: Dictionary, franchise: Dictionary, target: Dictionary) -> void:
	var next_tier: int = mini(5, target.currentTier + 1)
	match target.kind:
		"station":
			set_station_tier(franchise, target.id, next_tier)
			if target.id == "checkout-1": franchise.checkoutLevel = next_tier
			if target.id == "shelves-1": franchise.shelvesLevel = next_tier
		"player-speed": franchise.playerSpeedTier = next_tier
		"player-capacity":
			if target.currentTier >= CarrySystem.CAPACITY_TIERS.size(): return
			var next_capacity: int = CarrySystem.CAPACITY_TIERS[target.currentTier]
			if next_capacity <= franchise.carry.capacity: return
			franchise.playerCapacityTier = target.currentTier + 1
			franchise.carry.capacity = next_capacity
		"employee":
			var worker = find_id(franchise.employees, target.id)
			if worker != null: worker.level = next_tier
		"hire": franchise.employees.append(employee(franchise, target.id, state.countryCode, state.simulationTimeMs, JS.uuid()))

static func upgrade_unavailable_message(upgrade: String, campaign: bool = false) -> String:
	if campaign and upgrade in ["player-speed", "player-capacity"]: return "Compra primero «Carga 4 y velocidad +3 %»; después podrás seguir mejorando hasta el máximo."
	match upgrade:
		"player-speed": return "La mejora de velocidad se desbloquea en nivel 3 o ya está al máximo."
		"player-capacity": return "La mejora de carga se desbloquea en nivel 3 o ya está al máximo."
		"employee": return "No hay nuevas contrataciones o formaciones disponibles."
	return "Todas las estaciones disponibles ya están al máximo."
