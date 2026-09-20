class_name EngineCustomers
extends RefCounted
const P = preload("res://game/core/engine_progression.gd")
const Paths = preload("res://game/core/engine_paths.gd")
const Checkout = preload("res://game/core/engine_checkout.gd")
const QUEUE_STATES = ["NAVIGATE_TO_QUEUE", "QUEUE_WAIT", "MOVE_QUEUE", "UNLOAD"]

static func basket_units(customer: Dictionary) -> int:
	var total := 0
	for quantity in customer.basket.values(): total += quantity if quantity != null else 0
	return total

static func set_product_path(franchise: Dictionary, customer: Dictionary, pathfinder: Callable = Callable()) -> void:
	if customer.currentLine >= customer.shoppingList.size():
		Paths.set_customer_path(customer, [])
		return
	var line: Dictionary = customer.shoppingList[customer.currentLine]
	var used := {}
	for candidate in franchise.customers:
		if candidate.id != customer.id and candidate.get("reservedSocketId"): used[candidate.reservedSocketId] = true
	var slot := -1
	for candidate in 4:
		if "%s:%d" % [line.productId, candidate] not in used:
			slot = candidate
			break
	if slot == -1:
		customer.reservedSocketId = null
		if customer.waitingSince == null: customer.waitingSince = customer.stateSince
		Paths.set_customer_state(customer, "WAIT_FOR_ACCESS", customer.stateSince)
		return
	customer.reservedSocketId = "%s:%d" % [line.productId, slot]
	var base := RetailLayout.retail_service_point(line.productId)
	var offsets := [[-0.38, 0], [0.38, 0], [0, -0.38], [0, 0.38]]
	Paths.set_customer_path(customer, Paths.navigate_path(pathfinder, [customer.x, customer.z], [base[0] + offsets[slot][0], base[1] + offsets[slot][1]]))

static func spawn_customer_if_needed(state: Dictionary, franchise: Dictionary, pathfinder: Callable = Callable()) -> void:
	var active: Array = franchise.customers.filter(func(customer): return customer.state != "DESPAWN")
	var campaign: bool = franchise.get("purchases") != null
	var level: int = CampaignLevels.campaign_level(franchise) if campaign else state.level
	var maximum: int = CampaignLocations.campaign_customer_limit(level) if campaign else (mini(12, 3 + floori(state.level / 2.0)) if state.level < 20 else mini(30, 12 + floori((state.level - 20) * 1.8)))
	if campaign:
		if not CustomerTraffic.campaign_needs_customer(active, maximum): return
	elif active.size() >= maximum or state.simulationTimeMs - franchise.lastCustomerSpawnAt < 3000: return
	var sequence: int = franchise.nextCustomerSequence
	franchise.nextCustomerSequence += 1
	var identity: int = (sequence - 1) % 6 + 1
	var id := "%s-customer-%d" % [franchise.id, sequence]
	var available: Array = MartCampaign.campaign_available_products(franchise.purchases) if campaign else Objectives.unlocked_customer_products(state.level)
	var mind := CustomerBrain.create_customer_mind(id, available, sequence * 2654435761, state.level)
	if campaign:
		var seed: int = (sequence * 2654435761) & 0xffffffff
		if seed >= 0x80000000: seed -= 0x100000000
		mind.shoppingList = CampaignLocations.campaign_shopping_list(franchise.id, available, seed, level)
	var entry_x: float = -0.82 if identity % 2 else 0.82
	franchise.customers.append({"id": id, "identity": identity, "state": "ENTER_STORE", "shoppingList": mind.shoppingList, "currentLine": 0, "basket": {}, "patienceMs": mind.patienceMs, "checkoutPatienceMs": Checkout.CHECKOUT_PATIENCE_MS, "waitingSince": null, "queueSlot": null, "queueLane": 0, "queueJoinedAt": null, "transactionId": null, "hasCart": false, "hasBag": false, "angry": false, "x": entry_x, "z": 15.2, "targetX": entry_x, "targetZ": 5.6, "path": Paths.navigate_path(pathfinder, [entry_x, 15.2], StoreServiceLayout.CART_RETURN_POINT.duplicate()), "pathIndex": 0, "speed": CustomerTraffic.customer_walk_speed(identity), "currentSpeed": 0, "stateSince": state.simulationTimeMs, "reservedSocketId": null, "blockedSince": null, "routeFailures": 0})
	franchise.lastCustomerSpawnAt = state.simulationTimeMs

static func leave_without_purchase(customer: Dictionary, now: float, pathfinder: Callable = Callable()) -> void:
	customer.queueJoinedAt = null
	customer.queueSlot = null
	customer.currentSpeed = 0
	Paths.set_customer_state(customer, "NAVIGATE_TO_CART_RETURN", now)
	Paths.set_customer_path(customer, Paths.navigate_path(pathfinder, [customer.x, customer.z], StoreServiceLayout.CART_RETURN_POINT.duplicate()))

static func abandon_checkout(franchise: Dictionary, customer: Dictionary, now: float, events: Array, pathfinder: Callable = Callable(), reason: String = "caja sin atender") -> void:
	var transaction: Variant = null
	if customer.get("transactionId") != null: transaction = P.find_id(franchise.checkoutTransactions, customer.transactionId)
	if transaction != null and transaction.state != "COMPLETE":
		transaction.state = "ABANDONED"
		transaction.updatedAt = now
	customer.angry = true
	customer.waitingSince = null
	customer.reservedSocketId = null
	customer.currentSpeed = 0
	customer.queueJoinedAt = null
	customer.queueSlot = null
	customer.transactionId = null
	franchise.rating = JS.round(maxf(1, franchise.rating - 0.15) * 100) / 100.0
	Paths.set_customer_state(customer, "NAVIGATE_TO_RETURNS", now)
	Paths.set_customer_path(customer, Paths.navigate_path(pathfinder, [customer.x, customer.z], StoreServiceLayout.RETURNS_POINT.duplicate()))
	events.append({"franchiseId": franchise.id, "category": "returns", "description": "Cliente %s agotó sus 2 minutos de espera: %s" % [customer.id, reason], "amountMinor": 0, "payload": {"customerId": customer.id, "reason": reason}})

static func update_customer(state: Dictionary, franchise: Dictionary, customer: Dictionary, delta_ms: float, events: Array, pathfinder: Callable = Callable()) -> void:
	var now: float = state.simulationTimeMs
	if customer.state in ["NAVIGATE_TO_PRODUCT", "WAIT_FOR_ACCESS", "PICK_PRODUCT", "WAIT_RESTOCK"] and customer.waitingSince != null and now - customer.waitingSince >= CustomerPatience.CUSTOMER_PATIENCE_MS:
		abandon_checkout(franchise, customer, now, events, pathfinder, "producto no disponible")
		return
	if not customer.transactionId and customer.state in QUEUE_STATES and basket_units(customer) == 0:
		leave_without_purchase(customer, now, pathfinder)
		return
	if customer.state in QUEUE_STATES + ["WAIT_CHECKOUT"] and customer.get("queueJoinedAt") != null and now - customer.queueJoinedAt >= Checkout.CHECKOUT_PATIENCE_MS:
		abandon_checkout(franchise, customer, now, events, pathfinder)
		return
	match customer.state:
		"ENTER_STORE":
			if Paths.walk_customer_through_automatic_door(customer, franchise, delta_ms, "ENTER"): Paths.set_customer_state(customer, "GET_CART", now)
		"GET_CART":
			if now - customer.stateSince >= 450:
				customer.hasCart = true
				Paths.set_customer_state(customer, "BUILD_SHOPPING_LIST", now)
		"BUILD_SHOPPING_LIST":
			Paths.set_customer_state(customer, "NAVIGATE_TO_PRODUCT", now)
			set_product_path(franchise, customer, pathfinder)
		"NAVIGATE_TO_PRODUCT":
			if Paths.walk_path_actor(customer, delta_ms): Paths.set_customer_state(customer, "WAIT_FOR_ACCESS", now)
		"WAIT_FOR_ACCESS":
			if now - customer.stateSince < 250: return
			if not customer.reservedSocketId:
				Paths.set_customer_state(customer, "NAVIGATE_TO_PRODUCT", now)
				set_product_path(franchise, customer, pathfinder)
				return
			var line: Variant = customer.shoppingList[customer.currentLine] if customer.currentLine < customer.shoppingList.size() else null
			if line == null or line.picked >= line.requested: Paths.set_customer_state(customer, "NEXT_PRODUCT", now)
			elif franchise.shelves[line.productId] > 0: Paths.set_customer_state(customer, "PICK_PRODUCT", now)
			else:
				if customer.waitingSince == null: customer.waitingSince = now
				Paths.set_customer_state(customer, "WAIT_RESTOCK", now)
		"PICK_PRODUCT":
			if now - customer.stateSince < 520: return
			var line: Variant = customer.shoppingList[customer.currentLine] if customer.currentLine < customer.shoppingList.size() else null
			if line == null or franchise.shelves[line.productId] <= 0:
				if customer.waitingSince == null: customer.waitingSince = now
				Paths.set_customer_state(customer, "WAIT_RESTOCK", now)
				return
			franchise.shelves[line.productId] -= 1
			line.picked += 1
			customer.basket[line.productId] = customer.basket.get(line.productId, 0) + 1
			customer.reservedSocketId = null
			if line.picked >= line.requested:
				customer.waitingSince = null
				customer.currentLine += 1
				Paths.set_customer_state(customer, "NEXT_PRODUCT", now)
			else: Paths.set_customer_state(customer, "WAIT_FOR_ACCESS", now)
		"WAIT_RESTOCK":
			var line: Variant = customer.shoppingList[customer.currentLine] if customer.currentLine < customer.shoppingList.size() else null
			if line != null and franchise.shelves[line.productId] > 0:
				Paths.set_customer_state(customer, "NAVIGATE_TO_PRODUCT", now)
				set_product_path(franchise, customer, pathfinder)
		"NEXT_PRODUCT":
			if customer.currentLine < customer.shoppingList.size():
				Paths.set_customer_state(customer, "NAVIGATE_TO_PRODUCT", now)
				set_product_path(franchise, customer, pathfinder)
			elif basket_units(customer) == 0: leave_without_purchase(customer, now, pathfinder)
			else:
				Paths.set_customer_state(customer, "NAVIGATE_TO_QUEUE", now)
				customer.queueJoinedAt = now
				Paths.set_customer_path(customer, Paths.queue_arrival_path(pathfinder, [customer.x, customer.z], franchise.customers.size() - 1, JS.get_or(customer, "queueLane", 0)))
		"NAVIGATE_TO_QUEUE", "MOVE_QUEUE":
			if Paths.walk_path_actor(customer, delta_ms): Paths.set_customer_state(customer, "UNLOAD" if customer.queueSlot == 0 else "QUEUE_WAIT", now)
		"QUEUE_WAIT":
			if customer.queueSlot == 0:
				Paths.set_customer_state(customer, "MOVE_QUEUE", now)
				Paths.set_customer_path(customer, Paths.queue_arrival_path(pathfinder, [customer.x, customer.z], 0, JS.get_or(customer, "queueLane", 0)))
		"UNLOAD":
			if now - customer.stateSince < 300 or customer.transactionId: return
			var items: Array = []
			for product in customer.basket:
				var quantity: int = customer.basket[product]
				if quantity <= 0: continue
				items.append({"productId": product, "quantity": mini(CustomerBrain.MAX_SHOPPING_LINE_UNITS, quantity), "loaded": 0, "scanned": 0, "bagged": 0})
				if items.size() >= CustomerBrain.MAX_SHOPPING_LINES: break
			if items.is_empty():
				customer.queueJoinedAt = null
				customer.queueSlot = null
				Paths.set_customer_state(customer, "NAVIGATE_TO_CART_RETURN", now)
				Paths.set_customer_path(customer, Paths.navigate_path(pathfinder, [customer.x, customer.z], StoreServiceLayout.CART_RETURN_POINT.duplicate()))
				return
			var transaction := {"id": JS.uuid(), "customerId": customer.id, "pendingItems": items, "paymentMethod": "cash" if (int(franchise.customersToday) + int(customer.identity)) % 2 else "card", "state": "CUSTOMER_LOADING", "nextUnitIndex": 0, "paymentCommitted": false, "updatedAt": now, "lastLoadedAt": now, "lastScannedAt": now, "lastBaggedAt": now, "checkoutLane": JS.get_or(customer, "queueLane", 0)}
			franchise.checkoutTransactions.append(transaction)
			customer.transactionId = transaction.id
			Paths.set_customer_state(customer, "WAIT_CHECKOUT", now)
		"NAVIGATE_TO_BAG":
			if Paths.walk_path_actor(customer, delta_ms): Paths.set_customer_state(customer, "TAKE_BAG", now)
		"TAKE_BAG":
			if now - customer.stateSince >= Checkout.CHECKOUT_BAG_HANDOFF_MS:
				customer.hasBag = true
				customer.transactionId = null
				customer.basket = {}
				Paths.set_customer_state(customer, "NAVIGATE_TO_CART_RETURN", now)
				Paths.set_customer_path(customer, Paths.navigate_path(pathfinder, [customer.x, customer.z], StoreServiceLayout.CART_RETURN_POINT.duplicate()))
		"NAVIGATE_TO_RETURNS":
			if not CustomerPatience.customer_showing_anger(customer, now) and Paths.walk_path_actor(customer, delta_ms): Paths.set_customer_state(customer, "LEAVE_RETURNS", now)
		"LEAVE_RETURNS":
			if now - customer.stateSince >= 450:
				for product in customer.basket: franchise.returnsBin[product] += customer.basket[product]
				customer.basket = {}
				Paths.set_customer_state(customer, "NAVIGATE_TO_CART_RETURN", now)
				Paths.set_customer_path(customer, Paths.navigate_path(pathfinder, [customer.x, customer.z], StoreServiceLayout.CART_RETURN_POINT.duplicate()))
		"NAVIGATE_TO_CART_RETURN":
			if Paths.walk_path_actor(customer, delta_ms): Paths.set_customer_state(customer, "RETURN_CART", now)
		"RETURN_CART":
			if now - customer.stateSince >= 420:
				if customer.hasCart: franchise.returnedCartCount += 1
				customer.hasCart = false
				Paths.set_customer_state(customer, "EXIT_STORE", now)
				Paths.set_customer_path(customer, Paths.navigate_path(pathfinder, [customer.x, customer.z], [-0.82 if int(customer.identity) % 2 else 0.82, 15.4]))
		"EXIT_STORE":
			if Paths.walk_customer_through_automatic_door(customer, franchise, delta_ms, "EXIT"): Paths.set_customer_state(customer, "DESPAWN", now)

static func update_customer_queue(franchise: Dictionary, pathfinder: Callable = Callable()) -> void:
	var queued: Array = franchise.customers.filter(func(customer): return customer.state in QUEUE_STATES + ["WAIT_CHECKOUT", "PAY"])
	queued.sort_custom(func(a, b):
		var left: float = JS.get_or(a, "queueJoinedAt", a.stateSince)
		var right: float = JS.get_or(b, "queueJoinedAt", b.stateSince)
		return a.id < b.id if left == right else left < right)
	var lanes: Array = []
	for lane in CheckoutLayout.open_checkout_lane_count(franchise.unlockedAreas): lanes.append([])
	for customer in queued:
		var existing: int = JS.get_or(customer, "queueLane", 0)
		var shortest := 0
		for lane in lanes.size():
			if lanes[lane].size() < lanes[shortest].size(): shortest = lane
		var lane: int = existing if existing < lanes.size() and lanes[existing].size() <= lanes[shortest].size() else shortest
		lanes[lane].append(customer)
	franchise.queueCustomerIds = []
	for lane in lanes.size():
		for slot in lanes[lane].size():
			var customer: Dictionary = lanes[lane][slot]
			var changed: bool = customer.queueSlot != slot or customer.queueLane != lane
			customer.queueLane = lane
			customer.queueSlot = slot
			var destination := Paths.queue_position(slot, lane)
			var final_target: Array = customer.path.back() if not customer.path.is_empty() else [customer.targetX, customer.targetZ]
			var target_changed := JS.hypot(final_target[0] - destination[0], final_target[1] - destination[1]) > 0.08
			if (changed or target_changed) and customer.state in ["NAVIGATE_TO_QUEUE", "QUEUE_WAIT", "MOVE_QUEUE"]:
				customer.state = "MOVE_QUEUE"
				Paths.set_customer_path(customer, Paths.queue_arrival_path(pathfinder, [customer.x, customer.z], slot, lane))
			elif customer.state in ["UNLOAD", "WAIT_CHECKOUT", "PAY"] and JS.hypot(customer.x - destination[0], customer.z - destination[1]) > 0.08:
				customer.x = destination[0]
				customer.z = destination[1]
				customer.targetX = destination[0]
				customer.targetZ = destination[1]
				customer.path = []
				customer.pathIndex = 0
				customer.currentSpeed = 0
			franchise.queueCustomerIds.append(customer.id)
