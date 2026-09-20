class_name EngineCheckout
extends RefCounted
const Progression = preload("res://game/core/engine_progression.gd")
const Paths = preload("res://game/core/engine_paths.gd")
const CHECKOUT_PATIENCE_MS = CustomerPatience.CUSTOMER_PATIENCE_MS
const CHECKOUT_LOAD_UNIT_MS = 900
const CHECKOUT_SCAN_UNIT_MS = 700
const CHECKOUT_BAG_UNIT_MS = 650
const CHECKOUT_PAYMENT_MS = 1800
const CHECKOUT_BAG_HANDOFF_MS = 900

static func checkout_scan_interval(franchise: Dictionary, transaction: Dictionary, cashier: Variant = null) -> float:
	var lane: int = JS.get_or(transaction, "checkoutLane", 0)
	var till_speed: float = Levels.station_tier_modifiers(franchise.stationTiers.get("checkout-%d" % (lane + 1), franchise.checkoutLevel)).speed
	var cashier_speed: float = EmployeeStats.cashier_till_modifiers(cashier.level).speed if cashier != null else 1
	return CHECKOUT_SCAN_UNIT_MS / (till_speed * cashier_speed)

static func checkout_bag_interval(cashier: Variant = null) -> float:
	return CHECKOUT_BAG_UNIT_MS / float(EmployeeStats.cashier_till_modifiers(cashier.level).capacity if cashier != null else 1)

static func lane_cashier(franchise: Dictionary, lane: int) -> Variant:
	for employee in franchise.employees:
		if employee.role != "cashier" or employee.get("runtime") == null: continue
		var runtime: Dictionary = employee.runtime
		if runtime.assignedStationId == "checkout-%d" % (lane + 1) and runtime.state in ["OPERATE_CHECKOUT", "WAIT_CHECKOUT_STATION"]: return employee
	return null

static func checkout_unit_totals(transaction: Dictionary) -> Dictionary:
	var totals := {"total": 0, "loaded": 0, "scanned": 0, "bagged": 0}
	for line in transaction.pendingItems:
		totals.total += line.quantity
		totals.loaded += line.loaded
		totals.scanned += line.scanned
		totals.bagged += line.bagged
	return totals

static func process_checkout_unit(state: Dictionary, franchise: Dictionary, transaction: Dictionary, _events: Array, cashier: Variant = null) -> String:
	if transaction.state in ["COMPLETE", "ABANDONED"]: return "La caja ya no tiene una compra activa."
	var totals := checkout_unit_totals(transaction)
	if totals.loaded < totals.total: return "El cliente está colocando los productos en la cinta."
	if state.simulationTimeMs - transaction.lastScannedAt < checkout_scan_interval(franchise, transaction, cashier): return "El cajero está terminando de pasar el producto anterior."
	var line: Variant = null
	for candidate in transaction.pendingItems:
		if candidate.scanned < candidate.loaded:
			line = candidate
			break
	if line == null:
		if totals.bagged < totals.scanned: return "El embolsado automático está terminando."
		return "El cliente está realizando el pago." if transaction.state == "PAYMENT" else "No hay otro producto listo para escanear."
	if totals.bagged >= totals.scanned: transaction.lastBaggedAt = state.simulationTimeMs
	line.scanned += 1
	transaction.nextUnitIndex += 1
	transaction.lastScannedAt = state.simulationTimeMs
	transaction.updatedAt = state.simulationTimeMs
	transaction.state = "BAGGING" if transaction.pendingItems.all(func(candidate): return candidate.scanned >= candidate.quantity) else "SCANNING"
	return "Escaneado: %s." % Catalog.PRODUCTS[line.productId].name

static func can_process_checkout_unit(state: Dictionary, franchise: Dictionary) -> bool:
	var transaction: Variant = null
	for candidate in franchise.checkoutTransactions:
		if candidate.state not in ["COMPLETE", "ABANDONED"]:
			transaction = candidate
			break
	if transaction == null: return false
	var totals := checkout_unit_totals(transaction)
	if totals.loaded < totals.total: return false
	if state.simulationTimeMs - transaction.lastScannedAt < checkout_scan_interval(franchise, transaction): return false
	return transaction.pendingItems.any(func(line): return line.scanned < line.loaded)

static func update_checkout_transactions(state: Dictionary, franchise: Dictionary, events: Array, pathfinder: Callable = Callable()) -> void:
	var now: float = state.simulationTimeMs
	for transaction in franchise.checkoutTransactions:
		if transaction.state in ["COMPLETE", "ABANDONED"]: continue
		var changed := false
		for line in transaction.pendingItems:
			if line.loaded >= line.quantity: continue
			if now - transaction.lastLoadedAt >= CHECKOUT_LOAD_UNIT_MS:
				line.loaded += 1
				transaction.lastLoadedAt = now
				changed = true
			break
		for line in transaction.pendingItems:
			if line.bagged >= line.scanned: continue
			if now - transaction.lastBaggedAt >= checkout_bag_interval(lane_cashier(franchise, JS.get_or(transaction, "checkoutLane", 0))):
				line.bagged += 1
				transaction.lastBaggedAt = now
				changed = true
			break
		var totals := checkout_unit_totals(transaction)
		var next: String = "CUSTOMER_LOADING" if totals.loaded < totals.total else ("SCANNING" if totals.scanned < totals.total else ("BAGGING" if totals.bagged < totals.total else "PAYMENT"))
		if transaction.state != next:
			transaction.state = next
			changed = true
		if changed: transaction.updatedAt = now
		var customer = Progression.find_id(franchise.customers, transaction.customerId)
		if transaction.state == "PAYMENT" and customer != null:
			if customer.state == "WAIT_CHECKOUT": Paths.set_customer_state(customer, "PAY", now)
			if customer.state == "PAY" and now - customer.stateSince >= CHECKOUT_PAYMENT_MS:
				commit_checkout_payment(state, franchise, transaction, customer, events, pathfinder)

static func commit_checkout_payment(state: Dictionary, franchise: Dictionary, transaction: Dictionary, customer: Dictionary, events: Array, pathfinder: Callable = Callable()) -> void:
	if transaction.paymentCommitted: return
	var sale := 0
	var presentation: float = Levels.station_tier_modifiers(franchise.stationTiers.get("shelves-1", franchise.shelvesLevel)).value
	var campaign: bool = franchise.get("purchases") != null
	var level_value: float = CampaignLevels.campaign_price_multiplier(CampaignLevels.campaign_level(franchise)) if campaign else 1
	for line in transaction.pendingItems:
		var base: int = 100 if campaign and line.productId == "tomatoes" else (200 if campaign and line.productId == "eggs" else Catalog.PRODUCTS[line.productId].saleMinor)
		sale += JS.round(base * GameFactory.country_money_scale(state.countryCode) * presentation * level_value) * line.quantity
	var tax: int = 0 if campaign else JS.round(sale * Catalog.COUNTRIES[state.countryCode].salesTaxRate)
	var gross: int = sale if campaign else sale + tax
	if campaign: sale -= tax
	transaction.paymentCommitted = true
	transaction.state = "COMPLETE"
	transaction.updatedAt = state.simulationTimeMs
	var lane: int = JS.get_or(transaction, "checkoutLane", 0)
	franchise.registerCashMinor[lane] += gross
	state.finances.grossRevenueMinor += sale
	franchise.revenueTodayMinor += sale
	franchise.customersToday += 1
	var requested := 0
	var fulfilled := 0
	for line in customer.shoppingList:
		requested += line.requested
		fulfilled += line.picked
	var fulfillment: float = float(fulfilled) / requested if requested > 0 else 1
	var queue_seconds: float = 0 if customer.get("queueJoinedAt") == null else (state.simulationTimeMs - customer.queueJoinedAt) / 1000.0
	var score: float = clampf(3.5 + fulfillment * 1.5 - maxf(0, queue_seconds - 30) / 120.0, 1, 5)
	franchise.rating = JS.round((franchise.rating * 0.9 + score * 0.1) * 100) / 100.0
	state.reputation += 1
	Progression.gain(state, 20, "customers", 1)
	Progression.record_domain(state, "customers", 1)
	var units := 0
	for line in transaction.pendingItems: units += line.quantity
	Progression.record_domain(state, "sales:units", units)
	for line in transaction.pendingItems: Progression.record_domain(state, "sales:%s" % line.productId, line.quantity)
	if Objectives.average_shelf_availability(franchise) >= 0.9: Progression.record_domain(state, "availability:sales", 1)
	if customer.get("queueJoinedAt") != null and state.simulationTimeMs - customer.queueJoinedAt <= 30000: Progression.record_domain(state, "queue:under30", 1)
	if customer.shoppingList.size() >= 5 and customer.shoppingList.all(func(line): return line.picked >= line.requested): Progression.record_domain(state, "lists:five", 1)
	events.append({"franchiseId": franchise.id, "category": "sales", "description": "Compra %s · %s" % [transaction.id, "efectivo" if transaction.paymentMethod == "cash" else "tarjeta"], "amountMinor": gross, "payload": {"transactionId": transaction.id, "lane": lane}})
	customer.queueJoinedAt = null
	customer.queueSlot = null
	Paths.set_customer_state(customer, "NAVIGATE_TO_BAG", state.simulationTimeMs)
	Paths.set_customer_path(customer, Paths.navigate_path(pathfinder, [customer.x, customer.z], CheckoutLayout.CHECKOUT_LANES[lane].bagPickup.duplicate()))
