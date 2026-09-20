class_name EngineNormalization
extends RefCounted
const P = preload("res://game/core/engine_progression.gd")
const Employees = preload("res://game/core/engine_employees.gd")
const Day = preload("res://game/core/engine_day.gd")

static func normalize_inventory(input: Variant) -> Dictionary:
	var result := ProductRegistry.create_empty_inventory()
	for product in result:
		var value := JS.to_number(JS.get_or(input, product, 0) if input is Dictionary else 0)
		result[product] = NAN if is_nan(value) else maxf(0, floorf(value))
	return result

static func normalize_carry(input: Variant, fallback: int) -> Dictionary:
	var raw: Dictionary = input if input is Dictionary else {}
	var capacity_value: float = JS.to_number(raw.capacity) if "capacity" in raw else NAN
	var capacity: int = mini(CarrySystem.MAX_WAREHOUSE_PICKUP_BATCH, maxi(1, floori(capacity_value)) if is_finite(capacity_value) else fallback)
	var items := {}
	var products: Array = ProductRegistry.create_empty_inventory().keys()
	for product in products:
		var value := JS.to_number(JS.get_or(raw.get("items", {}), product, 0) if raw.get("items") is Dictionary else 0)
		var quantity: float = maxf(0, floorf(value)) if not is_nan(value) else NAN
		if quantity > 0: items[product] = quantity
	if items.is_empty() and raw.get("item") is Dictionary and raw.item.get("productId") in products:
		var value := JS.to_number(JS.get_or(raw.item, "quantity", 0))
		var quantity: float = maxf(0, floorf(value)) if not is_nan(value) else NAN
		if quantity > 0: items[raw.item.productId] = quantity
	var normalized := {"capacity": capacity, "items": {}}
	for product in products:
		var quantity: float = minf(items.get(product, 0), capacity - CarrySystem.carry_total(normalized))
		if quantity > 0: normalized.items[product] = quantity
	return normalized

static func normalize_crop_clock(crop: Dictionary, simulation_now: float, wall_now: float, level: int) -> Dictionary:
	if crop.status != "GROWING": return crop
	var configured := StationSystem.crop_growth_duration_ms(crop.productId, crop.tier, level)
	var stored: float = crop.readyAt - crop.plantedAt
	var duration: float = stored if is_finite(stored) and stored > 0 else configured
	if crop.readyAt - simulation_now <= maxf(60000, duration * 2): return StationSystem.update_crop(crop, simulation_now)
	var remaining: float = minf(duration, maxf(0, crop.readyAt - wall_now))
	var rebased := crop.duplicate(true)
	rebased.readyAt = simulation_now + remaining
	rebased.plantedAt = rebased.readyAt - duration
	return StationSystem.update_crop(rebased, simulation_now)

static func normalize_machine_clock(machine: Dictionary, simulation_now: float, wall_now: float) -> Dictionary:
	if machine.status != "PROCESSING" or machine.completesAt == null: return machine
	var configured: float = Products.PRODUCT_CONFIG.get(machine.productId, {}).get("cycleMs", 1000) / Levels.station_tier_modifiers(machine.tier).speed
	var stored: float = configured if machine.startedAt == null else machine.completesAt - machine.startedAt
	var duration: float = stored if is_finite(stored) and stored > 0 else configured
	if machine.completesAt - simulation_now <= maxf(60000, duration * 2): return StationSystem.update_machine(machine, simulation_now)
	var remaining: float = minf(duration, maxf(0, machine.completesAt - wall_now))
	var rebased := machine.duplicate(true)
	rebased.completesAt = simulation_now + remaining
	rebased.startedAt = rebased.completesAt - duration
	return StationSystem.update_machine(rebased, simulation_now)

static func reconcile_missions_for_current_level(state: Dictionary) -> Array:
	if Day.is_campaign_game(state): return []
	var expected := GameFactory.missions_for_day(state.day, GameFactory.country_money_scale(state.countryCode), state.level)
	var existing: Array = state.missions if state.get("missions") is Array else []
	var result: Array = []
	for template in expected:
		var harvest: Variant = P.find_id(existing, "d%d-harvest" % state.day) if template.kind == "production" else null
		if harvest != null:
			template.id = "d%d-harvest" % state.day
			template.label = "Cosecha %d productos" % template.target
			template.kind = "harvest"
		var previous = P.find_id(existing, template.id)
		if previous == null and template.kind == "harvest" and harvest == null: previous = P.find_id(existing, "d%d-produce" % state.day)
		if previous != null:
			var amount := JS.to_number(previous.get("progress"))
			if is_nan(amount): amount = 0
			template.progress = minf(template.target, maxf(0, floorf(amount)))
			template.completed = bool(previous.get("completed")) or template.progress >= template.target
			template.claimed = template.completed and bool(previous.get("claimed"))
		result.append(template)
	return result

static func _default(dict: Dictionary, key: String, value: Variant) -> void:
	if dict.get(key) == null: dict[key] = value

static func _integer(value: Variant) -> bool:
	return JS.is_finite_number(value) and floorf(value) == value

static func _locked_crop(id: String, product: String) -> Dictionary:
	var crop := StationSystem.create_empty_crop(id, product)
	crop.status = "LOCKED"
	return crop

static func _date_ms(value: Variant) -> float:
	if not value is String or value.is_empty(): return 0
	var unix := Time.get_unix_time_from_datetime_string(value)
	var regex := RegEx.create_from_string("\\.(\\d+)")
	var match_value := regex.search(value)
	return unix * 1000.0 + (float("0." + match_value.get_string(1)) * 1000 if match_value != null else 0)

static func normalize_game_state(input: Variant) -> Dictionary:
	if not input is Dictionary: return GameFactory.create_initial_game()
	var state: Dictionary = input.duplicate(true)
	var source_version: int = int(state.schemaVersion) if _integer(state.get("schemaVersion")) else 0
	var legacy := GameFactory.DEFAULT_AVATAR.duplicate()
	legacy.hat = "red-panda"
	var inherited_legacy: bool = source_version >= 1 and source_version < 4 and state.get("avatar") is Dictionary and legacy.keys().all(func(key): return state.avatar.get(key) == legacy[key])
	state.schemaVersion = 4
	var avatar := GameFactory.DEFAULT_AVATAR.duplicate()
	if state.get("avatar") is Dictionary: avatar.merge(state.avatar, true)
	state.avatar = avatar
	if inherited_legacy: state.avatar.hat = "none"
	if not _integer(state.get("eventSequence")): state.eventSequence = 0
	state.processedEventIds = state.processedEventIds.filter(func(id): return id is String) if state.get("processedEventIds") is Array else []
	state.processedEventIds = state.processedEventIds.slice(maxi(0, state.processedEventIds.size() - 1000))
	if not JS.is_finite_number(state.get("lastServerTime")): state.lastServerTime = maxf(0, _date_ms(state.get("lastSavedAt")))
	if not JS.is_finite_number(state.get("simulationTimeMs")): state.simulationTimeMs = 0
	_default(state, "progression", {"completedLevels": [], "counters": {}, "levelStartedCounters": {}, "playerActionCount": 0, "levelStartedPlayerActionCount": 0, "objectiveComplete": false, "lastUnlockAt": 0})
	_default(state.progression, "counters", {})
	_default(state.progression, "levelStartedCounters", {})
	state.progression.playerActionCount = maxi(0, floori(state.progression.playerActionCount)) if JS.is_finite_number(state.progression.get("playerActionCount")) else 0
	state.progression.levelStartedPlayerActionCount = mini(state.progression.playerActionCount, maxi(0, floori(state.progression.levelStartedPlayerActionCount))) if JS.is_finite_number(state.progression.get("levelStartedPlayerActionCount")) else 0
	var hats: Array = Catalog.HATS.map(func(hat): return hat.id)
	if state.avatar.hat != "none" and str(state.avatar.hat) not in hats: state.avatar.hat = "none"
	for franchise in state.get("franchises", []):
		var template = P.find_id(Catalog.FRANCHISE_TEMPLATES, franchise.id)
		if template != null: franchise.unlockLevel = template.unlockLevel
		_default(franchise, "businessDay", state.day if franchise.id == state.currentFranchiseId or franchise.open else 1)
		_default(franchise, "businessMinute", state.minuteOfDay if franchise.id == state.currentFranchiseId or franchise.open else BusinessDay.BUSINESS_DAY_OPEN_MINUTE)
		franchise.warehouse = normalize_inventory(franchise.get("warehouse"))
		if franchise.get("supplyFocus") != null and not (franchise.supplyFocus.target <= Employees.WAREHOUSE_PRODUCT_CAP) and franchise.warehouse[franchise.supplyFocus.productId] < Employees.WAREHOUSE_PRODUCT_CAP: franchise.supplyFocus.target = Employees.WAREHOUSE_PRODUCT_CAP
		franchise.shelves = normalize_inventory(franchise.get("shelves"))
		franchise.carry = normalize_carry(franchise.get("carry"), 3)
		_default(franchise, "crops", [StationSystem.create_crop("crop-tomato-1", "tomatoes", state.simulationTimeMs, 1, state.level), _locked_crop("crop-wheat-1", "wheat"), _locked_crop("crop-corn-1", "corn"), _locked_crop("crop-orange-1", "oranges")])
		for entry in [["orange", "oranges"], ["coffee", "coffee"]]:
			var id: String = "crop-%s-1" % entry[0]
			if P.find_id(franchise.crops, id) == null: franchise.crops.append(_locked_crop(id, entry[1]))
		if P.find_id(franchise.crops, "crop-apple-1") == null:
			franchise.crops.insert(1, StationSystem.create_crop("crop-apple-1", "apples", state.simulationTimeMs, 1, state.level) if state.level >= 2 else _locked_crop("crop-apple-1", "apples"))
			if state.level >= 2: P.ensure_tier(franchise, "crop-apple-1")
		for index in franchise.crops.size():
			var crop: Dictionary = franchise.crops[index]
			franchise.crops[index] = StationSystem.create_crop(crop.id, crop.productId, state.simulationTimeMs, crop.tier, state.level, crop.get("baseYield")) if crop.status == "EMPTY" else normalize_crop_clock(crop, state.simulationTimeMs, state.lastServerTime, state.level)
		_default(franchise, "productionMachines", [StationSystem.create_machine("flour-mill-1", "flour"), StationSystem.create_machine("bread-oven-1", "bread"), StationSystem.create_machine("cheese-maker-1", "cheese"), StationSystem.create_machine("juice-machine-1", "juice")])
		for entry in [["chicken-coop-1", "eggs", 8], ["cow-station-1", "milk", 13]]:
			if P.find_id(franchise.productionMachines, entry[0]) == null:
				var machine := StationSystem.create_machine(entry[0], entry[1])
				machine.status = "WAITING_INPUT" if state.level >= entry[2] else "LOCKED"
				franchise.productionMachines.append(machine)
		for index in franchise.productionMachines.size():
			var machine: Dictionary = franchise.productionMachines[index]
			var normalized := normalize_machine_clock(machine, state.simulationTimeMs, state.lastServerTime)
			normalized = normalized.duplicate(true)
			normalized.outputCapacity = maxi(machine.output, JS.round(Products.PRODUCT_CONFIG.get(machine.productId, {}).get("outputCapacity", 8) * Levels.station_tier_modifiers(machine.tier).capacity))
			franchise.productionMachines[index] = normalized
		_default(franchise, "buildProjects", [])
		franchise.buildProjects = franchise.buildProjects.filter(func(project): return _integer(project.level) and project.level >= 2 and project.level <= 30).map(func(project): return P.normalize_build_project(project, state.countryCode))
		P.ensure_next_build_project(state, franchise)
		_default(franchise, "checkoutTransactions", [])
		franchise.registerCashMinor = P.normalize_register_cash(franchise.get("registerCashMinor"))
		_default(franchise, "customers", [])
		franchise.returnsBin = normalize_inventory(franchise.get("returnsBin"))
		franchise.returnedCartCount = maxi(0, floori(franchise.returnedCartCount)) if JS.is_finite_number(franchise.get("returnedCartCount")) else 6
		for customer in franchise.customers:
			if customer.state == "GET_BASKET": customer.state = "GET_CART"
			if customer.state == "RECEIVE_BAG": customer.state = "TAKE_BAG"
			for key in ["reservedSocketId", "blockedSince", "queueJoinedAt"]: _default(customer, key, null)
			for key in ["routeFailures", "queueLane", "currentSpeed"]: _default(customer, key, 0)
			customer.speed = CustomerTraffic.customer_walk_speed(customer.identity)
			customer.checkoutPatienceMs = CustomerPatience.CUSTOMER_PATIENCE_MS
			customer.patienceMs = CustomerPatience.CUSTOMER_PATIENCE_MS
			_default(customer, "hasCart", customer.state not in ["SPAWN", "ENTER_STORE", "GET_CART", "EXIT_STORE", "DESPAWN"])
			_default(customer, "hasBag", customer.state in ["TAKE_BAG", "NAVIGATE_TO_CART_RETURN", "RETURN_CART", "EXIT_STORE"])
			_default(customer, "angry", false)
			customer.shoppingList = customer.shoppingList.slice(0, CustomerBrain.MAX_SHOPPING_LINES)
			for line in customer.shoppingList:
				line.requested = clampi(floori(line.requested) if JS.is_finite_number(line.requested) else 0, 0, CustomerBrain.MAX_SHOPPING_LINE_UNITS)
				line.picked = clampi(floori(line.picked) if JS.is_finite_number(line.picked) else 0, 0, line.requested)
			customer.currentLine = clampi(customer.currentLine, 0, customer.shoppingList.size())
		for transaction in franchise.checkoutTransactions:
			_default(transaction, "checkoutLane", 0)
			for key in ["lastLoadedAt", "lastScannedAt", "lastBaggedAt"]: _default(transaction, key, transaction.updatedAt)
			transaction.pendingItems = transaction.pendingItems.slice(0, CustomerBrain.MAX_SHOPPING_LINES)
			for line in transaction.pendingItems:
				line.quantity = clampi(floori(line.quantity) if JS.is_finite_number(line.quantity) else 1, 1, CustomerBrain.MAX_SHOPPING_LINE_UNITS)
				_default(line, "loaded", line.quantity)
				_default(line, "bagged", line.scanned if transaction.state in ["BAGGING", "PAYMENT", "COMPLETE"] else 0)
				for key in ["loaded", "scanned", "bagged"]: line[key] = mini(line[key], line.quantity)
		var defaults := {"nextCustomerSequence": 1, "lastCustomerSpawnAt": -3000, "queueCustomerIds": [], "unlockedAreas": ["store-floor", "farm-tomato", "checkout-1"], "stationTiers": {"crop-tomato-1": 1, "checkout-1": 1}, "upgradeContributions": {}, "playerSpeedTier": 1, "storeRank": 1, "structureRevision": 1}
		for key in defaults: _default(franchise, key, defaults[key])
		P.ensure_tier(franchise, "shelves-1")
		franchise.playerCapacityTier = P.carry_capacity_tier(franchise.carry.capacity)
		P.ensure_checkouts_for_cashiers(franchise)
		_default(franchise, "doorState", "CLOSED")
		_default(franchise, "doorProgress", 1 if franchise.doorState == "OPEN" else 0)
		franchise.doorPlayerPresent = false
		franchise.doorEmptySince = null
		_default(franchise, "lightsOn", franchise.open)
		for index in franchise.get("employees", []).size():
			var worker: Dictionary = franchise.employees[index]
			if str(worker.get("hat")) not in hats: worker.hat = "red-panda"
			_default(worker, "runtime", P.create_employee_runtime(worker.role, index, state.simulationTimeMs))
			worker.runtime.carry = normalize_carry(worker.runtime.get("carry"), 2)
			_default(worker.runtime, "currentSpeed", 0)
			Employees.normalize_persisted_farm_employee(franchise, worker, state.simulationTimeMs)
		if franchise.owned and franchise.get("purchases") == null: P.synchronize_franchise_progression(state, franchise)
	if Day.is_campaign_game(state):
		for franchise in state.franchises:
			franchise.carry.capacity = maxi(franchise.carry.capacity, EmployeeStats.employee_carry_capacity(franchise.playerSpeedTier))
			franchise.playerCapacityTier = P.carry_capacity_tier(franchise.carry.capacity)
			P.sanitize_campaign_purchases(franchise)
			P.sync_campaign_crops(state, franchise)
			P.sync_campaign_staff(state, franchise)
			P.trim_campaign_staff(franchise)
			for crop in franchise.crops: _default(crop, "baseYield", StationSystem.CAMPAIGN_BED_YIELD)
		P.sync_campaign_progression(state)
	state.missions = reconcile_missions_for_current_level(state)
	return state
