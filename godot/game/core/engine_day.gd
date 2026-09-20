class_name EngineDay
extends RefCounted
const Progression = preload("res://game/core/engine_progression.gd")

static func is_campaign_game(state: Dictionary) -> bool:
	return state.franchises.any(func(franchise): return franchise.owned and franchise.get("purchases") != null)

static func global_event_franchise_id(state: Dictionary) -> String:
	for franchise in state.franchises:
		if franchise.id == state.currentFranchiseId: return franchise.id
	for franchise in state.franchises:
		if franchise.owned: return franchise.id
	return state.franchises[0].id if not state.franchises.is_empty() else state.currentFranchiseId

static func stamp_events(state: Dictionary, events: Array) -> void:
	for event in events:
		if not event.get("franchiseId"): event.franchiseId = global_event_franchise_id(state)
		if event.get("eventId") == null: event.eventId = JS.uuid()
		if event.get("sequence") == null:
			state.eventSequence += 1
			event.sequence = state.eventSequence
		if event.get("occurredAt") == null:
			var ms: int = int(state.lastServerTime)
			event.occurredAt = Time.get_datetime_string_from_unix_time(floori(ms / 1000.0)) + ".%03dZ" % posmod(ms, 1000)
		if event.get("type") == null: event.type = event.category
		if event.get("payload") == null: event.payload = {}
		if event.get("idempotencyKey") == null: event.idempotencyKey = event.eventId
		state.processedEventIds.append(event.eventId)
	state.processedEventIds = state.processedEventIds.slice(maxi(0, state.processedEventIds.size() - 1000))

static func deliver_orders(state: Dictionary) -> void:
	var pending: Array = []
	for order in state.pendingOrders:
		if order.franchiseId != state.currentFranchiseId or order.arrivesAtMinute > state.minuteOfDay:
			pending.append(order)
			continue
		var franchise = Progression.find_id(state.franchises, order.franchiseId)
		if franchise != null: franchise.warehouse[order.productId] += order.quantity
		Progression.record_domain(state, "deliveries", 1)
	state.pendingOrders = pending

static func settle_business_day(state: Dictionary, events: Array) -> void:
	var country: Dictionary = Catalog.COUNTRIES[state.countryCode]
	var money_scale := GameFactory.country_money_scale(state.countryCode)
	var payroll := 0
	var operating := 0
	var taxable_profit := 0
	var franchise := Progression.current_franchise(state)
	franchise.open = false
	if franchise.get("purchases") != null:
		franchise.licenseActive = true
	else:
		var base_payroll := 0
		for worker in franchise.employees: base_payroll += worker.salaryMinor
		payroll = JS.round(base_payroll * (1 + country.payrollBurdenRate))
		operating = JS.round((1900 * franchise.expansionLevel + 700 * franchise.checkoutLevel) * money_scale)
		events.append({"franchiseId": franchise.id, "category": "payroll", "description": "Nóminas y cargas laborales · %s" % franchise.name, "amountMinor": -payroll})
		events.append({"franchiseId": franchise.id, "category": "operations", "description": "Alquiler, energía y mantenimiento · %s" % franchise.name, "amountMinor": -operating})
		taxable_profit = franchise.revenueTodayMinor - franchise.expensesTodayMinor - payroll - operating
		franchise.licenseDaysLeft = maxi(0, franchise.licenseDaysLeft - 1)
		franchise.licenseActive = franchise.licenseDaysLeft > 0
	franchise.expensesTodayMinor = 0
	franchise.revenueTodayMinor = 0
	franchise.customersToday = 0
	for worker in franchise.employees: worker.energy = 100
	var tax := maxi(0, JS.round(taxable_profit * country.corporateTaxRate))
	state.balanceMinor -= payroll + operating + tax
	state.finances.payrollMinor += payroll
	state.finances.operatingCostsMinor += operating
	state.finances.taxesMinor += tax
	state.finances.netProfitMinor = state.finances.grossRevenueMinor - state.finances.costOfGoodsMinor - state.finances.payrollMinor - state.finances.operatingCostsMinor - state.finances.taxesMinor
	if tax > 0: events.append({"franchiseId": global_event_franchise_id(state), "category": "tax", "description": "Provisión fiscal %d%%" % JS.round(country.corporateTaxRate * 100), "amountMinor": -tax, "payload": {"scope": "global"}})
	state.day += 1
	state.minuteOfDay = BusinessDay.BUSINESS_DAY_OPEN_MINUTE
	franchise.businessDay = state.day
	franchise.businessMinute = state.minuteOfDay
	state.missions = [] if is_campaign_game(state) else GameFactory.missions_for_day(state.day, money_scale, state.level)

static func business_day_closure_message(state: Dictionary, day: int, automatic: bool) -> String:
	var all_campaign: bool = state.franchises.filter(func(franchise): return franchise.owned).all(func(franchise): return franchise.get("purchases") != null)
	return "Día %d cerrado%s. %s" % [day, " automáticamente" if automatic else "", "Progreso conservado, sin cargos diarios." if all_campaign else "Nóminas, operación e impuestos contabilizados."]

static func has_active_customers(franchise: Dictionary) -> bool:
	return franchise.customers.any(func(customer): return customer.state != "DESPAWN")

static func has_customers_in_store(franchise: Dictionary) -> bool:
	return franchise.customers.any(func(customer): return customer.state != "DESPAWN" and customer.z <= StorefrontLayout.STOREFRONT_LAYOUT.z)

static func remove_customers_who_never_entered(franchise: Dictionary, now: float) -> void:
	var admitted := {}
	for customer in franchise.customers:
		if customer.state != "DESPAWN" and customer.z <= StorefrontLayout.STOREFRONT_LAYOUT.z: admitted[customer.id] = true
	for customer in franchise.customers:
		if customer.id in admitted or customer.state == "DESPAWN": continue
		if customer.hasCart: franchise.returnedCartCount += 1
		customer.hasCart = false
		customer.queueSlot = null
		customer.queueJoinedAt = null
		customer.reservedSocketId = null
		customer.state = "DESPAWN"
		customer.stateSince = now
	franchise.queueCustomerIds = franchise.queueCustomerIds.filter(func(id): return id in admitted)

static func begin_business_day_closure(state: Dictionary, events: Array, automatic: bool = false) -> String:
	state.minuteOfDay = BusinessDay.BUSINESS_DAY_NIGHT_MINUTE
	var franchise := Progression.current_franchise(state)
	franchise.open = false
	remove_customers_who_never_entered(franchise, state.simulationTimeMs)
	franchise.lightsOn = has_customers_in_store(franchise)
	if not has_active_customers(franchise):
		var day: int = state.day
		settle_business_day(state, events)
		return business_day_closure_message(state, day, automatic)
	return "%s. Atendiendo a los últimos clientes antes del cierre de caja." % ("Son las 21:00: entrada cerrada automáticamente" if automatic else "Entrada cerrada")

static func update_automatic_door(franchise: Dictionary, now: float, delta_ms: float) -> void:
	var customers: bool = franchise.customers.any(func(customer): return customer.state != "DESPAWN" and StorefrontLayout.storefront_door_actor_present([customer.x, customer.z]))
	var employees: bool = franchise.employees.any(func(worker): return worker.get("runtime") != null and StorefrontLayout.storefront_door_actor_present([worker.runtime.x, worker.runtime.z]))
	if franchise.doorPlayerPresent or customers or employees:
		franchise.doorEmptySince = null
		if franchise.doorState != "OPEN": franchise.doorState = "OPENING"
		franchise.doorProgress = minf(1, franchise.doorProgress + delta_ms / 450.0)
		if franchise.doorProgress >= 1: franchise.doorState = "OPEN"
		return
	if franchise.doorEmptySince == null: franchise.doorEmptySince = now
	if franchise.doorState == "OPEN" and now - franchise.doorEmptySince < 700: return
	if franchise.doorProgress > 0:
		franchise.doorState = "CLOSING"
		franchise.doorProgress = maxf(0, franchise.doorProgress - delta_ms / 450.0)
		if franchise.doorProgress <= 0: franchise.doorState = "CLOSED"
