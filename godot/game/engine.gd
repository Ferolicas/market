class_name MarketEngine
extends RefCounted
## Native port of src/game/engine.ts. State remains plain JSON-compatible data.
## Helpers split by responsibility; presentation only dispatches these actions.
const Factory = preload("res://game/core/game_factory.gd")
const Normalization = preload("res://game/core/engine_normalization.gd")
const Progression = preload("res://game/core/engine_progression.gd")
const Actions = preload("res://game/core/engine_actions.gd")
const Day = preload("res://game/core/engine_day.gd")
const Checkout = preload("res://game/core/engine_checkout.gd")
const Customers = preload("res://game/core/engine_customers.gd")
const Employees = preload("res://game/core/engine_employees.gd")
const Paths = preload("res://game/core/engine_paths.gd")
const Money = preload("res://game/core/money_format.gd")
const DEFAULT_AVATAR = Factory.DEFAULT_AVATAR
const CHECKOUT_PATIENCE_MS = Checkout.CHECKOUT_PATIENCE_MS
const CHECKOUT_LOAD_UNIT_MS = Checkout.CHECKOUT_LOAD_UNIT_MS
const CHECKOUT_SCAN_UNIT_MS = Checkout.CHECKOUT_SCAN_UNIT_MS
const CHECKOUT_BAG_UNIT_MS = Checkout.CHECKOUT_BAG_UNIT_MS
const CHECKOUT_PAYMENT_MS = Checkout.CHECKOUT_PAYMENT_MS
const CHECKOUT_BAG_HANDOFF_MS = Checkout.CHECKOUT_BAG_HANDOFF_MS
const WAREHOUSE_PRODUCT_CAP = Employees.WAREHOUSE_PRODUCT_CAP
const SURPLUS_PRODUCTION_BATCH = Employees.SURPLUS_PRODUCTION_BATCH

static func create_initial_game(country_code: String = "ES") -> Dictionary:
	return Factory.create_initial_game(country_code)

static func create_campaign_game(country_code: String = "ES") -> Dictionary:
	return Factory.create_campaign_game(country_code)

static func normalize_game_state(input: Variant) -> Dictionary:
	return Normalization.normalize_game_state(input)

static func country_money_scale(country_code: String) -> float:
	return Factory.country_money_scale(country_code)

static func employee_hiring_quote(role: String, country_code: String) -> Dictionary:
	return Factory.employee_hiring_quote(role, country_code)

static func format_money(amount_minor: float, state: Dictionary) -> String:
	return Money.format_money(amount_minor, state)

static func apply_game_action(input: Dictionary, action: Dictionary) -> Dictionary:
	return Actions.apply_game_action(input, action)

static func advance_simulation(input: Dictionary, minutes: float = 10) -> Dictionary:
	return Actions.advance_simulation(input, minutes)

static func is_campaign_game(state: Dictionary) -> bool:
	return Day.is_campaign_game(state)

static func can_order_product(state: Dictionary, product: String) -> bool:
	return Actions.can_order_product(state, product)

static func can_hire_employee(state: Dictionary, role: String) -> bool:
	return Progression.can_hire_employee(state, role)

static func upgrade_quote(state: Dictionary, upgrade: String) -> Variant:
	return Progression.upgrade_quote(state, upgrade)

static func campaign_purchase_quotes(state: Dictionary) -> Array:
	var franchise := Progression.current_franchise(state)
	if franchise.get("purchases") == null: return []
	return MartCampaign.OPENING_PURCHASES.map(func(purchase): return PurchaseState.purchase_quote(franchise.purchases, purchase.id, state.countryCode))

static func campaign_personal_tasks(state: Dictionary) -> Array:
	var franchise := Progression.current_franchise(state)
	if franchise.get("purchases") == null: return []
	var available := MartCampaign.campaign_available_products(franchise.purchases)
	var result: Array = []
	for id in CampaignTasks.CAMPAIGN_TASK_IDS:
		var source: String = "eggs" if id == "player:feed:chicken" else ("milk" if id == "player:feed:cow" else id.split(":")[-1])
		if source in available: result.append(CampaignTasks.campaign_task_status(id, franchise.purchases.get("personalProgress"), franchise.id))
	return result

static func shelf_capacity_for_tier(tier: int, product: String, areas: Array = []) -> int:
	return RetailLayout.retail_shelf_capacity_for_tier(tier, product, areas)

static func store_supply_plan(franchise: Dictionary) -> Array:
	return Employees.store_supply_plan(franchise)

static func checkout_scan_interval(franchise: Dictionary, transaction: Dictionary, cashier: Variant = null) -> float:
	return Checkout.checkout_scan_interval(franchise, transaction, cashier)

static func checkout_bag_interval(cashier: Variant = null) -> float:
	return Checkout.checkout_bag_interval(cashier)

static func can_operate_machine(franchise: Dictionary, id: String, now_ms: float) -> bool:
	return Actions.can_operate_machine(franchise, id, now_ms)

static func can_process_checkout_unit(state: Dictionary, franchise: Dictionary) -> bool:
	return Checkout.can_process_checkout_unit(state, franchise)

static func apply_customer_avoidance(customers: Array) -> void:
	Paths.apply_customer_avoidance(customers)

static func advance_world(input: Dictionary, delta_ms: float = 250, pathfinder: Callable = Callable(), world_input: Dictionary = {}) -> Dictionary:
	var state := input.duplicate(true)
	var events: Array = []
	var message: Variant = null
	for action in JS.get_or(world_input, "interactions", []):
		var result := Actions.apply_game_action(state, action, false, false)
		message = result.message
		if result.ok:
			if action.type in Progression.COUNTS_AS_PLAYER_PROGRESS: state.progression.playerActionCount += 1
			events.append_array(result.events)
	var elapsed := clampf(delta_ms, 0, 1000)
	state.simulationTimeMs += elapsed
	if state.franchises.any(func(franchise): return franchise.owned and franchise.open): state.lastServerTime += BusinessDay.business_minutes_for_real_ms(elapsed) * 60000
	var visited_id: String = state.currentFranchiseId
	Progression.current_franchise(state).businessDay = state.day
	Progression.current_franchise(state).businessMinute = state.minuteOfDay
	var distance := clampf(JS.get_or(world_input, "playerDistanceMeters", 0), 0, 100)
	if distance > 0: Progression.record_domain(state, "distance:player", distance)
	for franchise in state.franchises:
		if not franchise.owned: continue
		state.currentFranchiseId = franchise.id
		state.day = JS.get_or(franchise, "businessDay", 1)
		state.minuteOfDay = JS.get_or(franchise, "businessMinute", BusinessDay.BUSINESS_DAY_OPEN_MINUTE)
		if franchise.open:
			var minutes := BusinessDay.business_minutes_for_real_ms(elapsed)
			state.minuteOfDay = minf(BusinessDay.BUSINESS_DAY_NIGHT_MINUTE, state.minuteOfDay + minutes)
			for worker in franchise.employees: worker.energy = maxf(15, worker.energy - 0.15 * minutes)
			Day.deliver_orders(state)
			if BusinessDay.business_day_is_closing(state.minuteOfDay): message = Day.begin_business_day_closure(state, events, true)
		for index in franchise.crops.size(): franchise.crops[index] = StationSystem.update_crop(franchise.crops[index], state.simulationTimeMs)
		for index in franchise.productionMachines.size(): franchise.productionMachines[index] = Progression.update_machine_with_progress(state, franchise.productionMachines[index])
		Day.update_automatic_door(franchise, state.simulationTimeMs, elapsed)
		franchise.lightsOn = franchise.open or (BusinessDay.business_day_is_closing(state.minuteOfDay) and Day.has_customers_in_store(franchise))
		if franchise.open: Customers.spawn_customer_if_needed(state, franchise, pathfinder)
		for index in franchise.employees.size():
			var worker: Dictionary = franchise.employees[index]
			if worker.get("runtime") == null: worker.runtime = Progression.create_employee_runtime(worker.role, index, state.simulationTimeMs)
			Employees.update_employee(state, franchise, worker, elapsed, events, pathfinder)
		Customers.update_customer_queue(franchise, pathfinder)
		for customer in franchise.customers: Customers.update_customer(state, franchise, customer, elapsed, events, pathfinder)
		if BusinessDay.business_day_is_closing(state.minuteOfDay):
			for transaction in franchise.checkoutTransactions: Checkout.process_checkout_unit(state, franchise, transaction, events)
		Checkout.update_checkout_transactions(state, franchise, events, pathfinder)
		Paths.apply_customer_avoidance(franchise.customers)
		Customers.update_customer_queue(franchise, pathfinder)
		franchise.customers = franchise.customers.filter(func(customer): return customer.state != "DESPAWN" or state.simulationTimeMs - customer.stateSince < 1000)
		franchise.checkoutTransactions = franchise.checkoutTransactions.filter(func(transaction):
			if transaction.state not in ["COMPLETE", "ABANDONED"]: return true
			return franchise.customers.any(func(customer): return customer.transactionId == transaction.id) or state.simulationTimeMs - transaction.updatedAt < 2000)
		if BusinessDay.business_day_is_closing(state.minuteOfDay) and not Day.has_active_customers(franchise):
			Day.settle_business_day(state, events)
			message = Day.business_day_closure_message(state, state.day - 1, true)
		franchise.businessDay = state.day
		franchise.businessMinute = state.minuteOfDay
	state.currentFranchiseId = visited_id
	state.day = JS.get_or(Progression.current_franchise(state), "businessDay", 1)
	state.minuteOfDay = JS.get_or(Progression.current_franchise(state), "businessMinute", BusinessDay.BUSINESS_DAY_OPEN_MINUTE)
	state.revision += 1
	Progression.normalize_level(state)
	Day.stamp_events(state, events)
	return {"state": state, "ok": true, "message": "Mundo actualizado." if message == null else message, "events": events}
