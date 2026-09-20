class_name SaveAuthority
extends RefCounted
## Port of src/game/persistence/SaveAuthority.ts. Server remains authoritative.
const Events = preload("res://game/persistence/domain_events.gd")

static func _invalid(code: String = "INVALID_STATE_TRANSITION") -> Dictionary:
	return {"ok": false, "code": code}

static func validate_save_transition(current: Dictionary, next: Dictionary, events: Array, options: Dictionary = {}) -> Dictionary:
	if not Events.validate_pending_events(events): return _invalid("INVALID_EVENTS")
	if next.schemaVersion != 4 or next.revision < current.revision or next.simulationTimeMs < current.simulationTimeMs or next.lastServerTime < current.lastServerTime: return _invalid()
	var campaign: bool = current.franchises.any(func(item): return item.get("purchases") != null)
	if next.level < current.level or (next.level != CampaignLevels.campaign_global_level(next) if campaign else next.level > mini(30, current.level + 2)) or next.xp < current.xp or next.reputation < current.reputation: return _invalid()
	if campaign:
		for franchise in next.franchises:
			for employee in franchise.employees:
				if franchise.employees.filter(func(item): return item.role == employee.role).size() > CampaignLevels.campaign_employee_limit(franchise, employee.role): return _invalid()
	if next.currency != Catalog.COUNTRIES[next.countryCode].currency: return _invalid()
	if current.tutorialStep > 0 and (next.countryCode != current.countryCode or next.currency != current.currency): return _invalid()
	if not next.franchises.any(func(franchise): return franchise.id == next.currentFranchiseId and franchise.owned): return _invalid()
	var conversion: bool = current.tutorialStep == 0 and current.countryCode != next.countryCode
	var scale: float = float(Catalog.COUNTRIES[next.countryCode].startingCapitalMinor) / Catalog.COUNTRIES[current.countryCode].startingCapitalMinor
	if current.franchises.size() != next.franchises.size(): return _invalid()
	for franchise in current.franchises:
		var candidate = JS.find(next.franchises, func(item): return item.id == franchise.id)
		if candidate == null: return _invalid()
		if (next.day if candidate.id == next.currentFranchiseId else JS.get_or(candidate, "businessDay", 1)) < (current.day if franchise.id == current.currentFranchiseId else JS.get_or(franchise, "businessDay", 1)): return _invalid()
		if candidate.name != franchise.name or candidate.city != franchise.city or candidate.unlockLevel != franchise.unlockLevel: return _invalid()
		if candidate.purchaseCostMinor != (JS.round(franchise.purchaseCostMinor * scale) if conversion else franchise.purchaseCostMinor): return _invalid()
		if franchise.owned and not candidate.owned: return _invalid()
		if not franchise.owned and candidate.owned and franchise.get("purchases") == null and next.level < candidate.unlockLevel: return _invalid()
	if not _progression_is_monotonic(current, next) or not _purchase_transfers_are_conserved(current, next, events) or not _campaign_openings_are_conserved(current, next, events): return _invalid()
	for franchise in next.franchises:
		if _has_invalid_inventory(franchise.warehouse) or _has_invalid_inventory(franchise.shelves) or _has_invalid_carry(franchise.carry): return _invalid()
		if franchise.rating < 1 or franchise.rating > 5: return _invalid()
		for field in ["expansionLevel", "shelvesLevel", "checkoutLevel", "playerSpeedTier", "playerCapacityTier"]:
			if not _valid_tier(franchise[field]): return _invalid()
		for employee in franchise.employees:
			if employee.has("runtime") and (not employee.runtime is Dictionary or _has_invalid_carry(employee.runtime.get("carry"))): return _invalid()
			if not _valid_tier(employee.level) or employee.energy < 0 or employee.energy > 100: return _invalid()
		for tier in franchise.stationTiers.values():
			if not _valid_tier(tier): return _invalid()
	var ids := {}
	var keys := {}
	var owned: Array = next.franchises.filter(func(franchise): return franchise.owned).map(func(franchise): return franchise.id)
	for index in events.size():
		var event: Dictionary = events[index]
		if not owned.has(event.franchiseId): return _invalid("INVALID_EVENTS")
		if event.sequence != current.eventSequence + index + 1 or ids.has(event.eventId) or keys.has(event.idempotencyKey): return _invalid("INVALID_SEQUENCE")
		ids[event.eventId] = true
		keys[event.idempotencyKey] = true
	if next.eventSequence != current.eventSequence + events.size(): return _invalid("INVALID_SEQUENCE")
	for event in events:
		if not next.processedEventIds.has(event.eventId): return _invalid("INVALID_EVENT_CHAIN")
	# JS slice(-0) means slice(0), including the >=1000-event boundary.
	for id in JS.slice(current.processedEventIds, -maxi(0, 1000 - events.size())):
		if not next.processedEventIds.has(id): return _invalid("INVALID_EVENT_CHAIN")
	var delta = 0
	for event in events: delta += event.amountMinor
	var current_tills = _till_total(current)
	var next_tills = _till_total(next)
	var wealth = next.balanceMinor - current.balanceMinor + next_tills - current_tills
	if not JS.is_safe_integer(wealth) or not JS.is_safe_integer(delta) or not JS.is_safe_integer(current_tills) or not JS.is_safe_integer(next_tills) or wealth != delta or not _register_transfers_are_conserved(current, next, events, options.get("allowLegacyWalletSales") == true): return _invalid("INVALID_BALANCE_DELTA")
	if not _positive_events_are_plausible(current, next, events): return _invalid("INVALID_BALANCE_DELTA")
	return {"ok": true}

static func _drawer(franchise: Dictionary, lane: int) -> Variant:
	var cash = franchise.get("registerCashMinor")
	return 0 if cash == null or lane >= cash.size() or cash[lane] == null else cash[lane]

static func _till_total(state: Dictionary) -> Variant:
	var total = 0
	for franchise in state.franchises:
		for lane in CheckoutLayout.CHECKOUT_LANE_IDS: total += _drawer(franchise, lane)
	return total

static func _register_transfers_are_conserved(current: Dictionary, next: Dictionary, events: Array, legacy: bool) -> bool:
	var balances := {}
	for franchise in current.franchises:
		balances[franchise.id] = CheckoutLayout.CHECKOUT_LANE_IDS.map(func(lane): return _drawer(franchise, lane))
	for event in events:
		if not ["sales", "cash_collection"].has(event.category): continue
		if legacy and event.category == "sales" and not event.payload.has("lane"): continue
		var lane = event.payload.get("lane")
		var balance = balances.get(event.franchiseId)
		if balance == null or not CheckoutLayout.is_checkout_lane(lane): return false
		if event.category == "sales":
			if event.amountMinor <= 0: return false
			balance[int(lane)] += event.amountMinor
		else:
			var amount = event.payload.get("collectedMinor")
			if event.amountMinor != 0 or not JS.is_safe_integer(amount) or amount <= 0 or amount > balance[int(lane)]: return false
			balance[int(lane)] -= amount
		if not JS.is_safe_integer(balance[int(lane)]): return false
	for franchise in next.franchises:
		var expected = balances.get(franchise.id)
		var actual = franchise.get("registerCashMinor")
		if expected == null or not actual is Array or actual.size() != CheckoutLayout.CHECKOUT_LANE_IDS.size(): return false
		for lane in actual.size():
			if not JS.is_safe_integer(actual[lane]) or actual[lane] < 0 or actual[lane] != expected[lane]: return false
	return true

static func _has_invalid_inventory(inventory: Dictionary) -> bool:
	for product in ProductRegistry.PRODUCT_IDS:
		var value = inventory.get(product)
		if not JS.is_safe_integer(value) or value < 0 or value > 1000000: return true
	return false

static func _purchase_transfers_are_conserved(current: Dictionary, next: Dictionary, events: Array) -> bool:
	var known := {}
	for purchase in MartCampaign.OPENING_PURCHASES: known[purchase.id] = true
	for franchise in current.franchises:
		var candidate = JS.find(next.franchises, func(item): return item.id == franchise.id)
		var transfers := events.filter(func(event): return event.franchiseId == franchise.id and ["purchase", "player_progress", "contract_delivery"].has(event.category))
		if candidate == null or candidate.get("purchases") == null:
			if franchise.get("purchases") != null or not transfers.is_empty(): return false
			continue
		if franchise.get("purchases") == null: return false
		var expected: Dictionary = franchise.purchases
		if current.countryCode != next.countryCode and not (current.tutorialStep == 0 and transfers.is_empty() and expected.purchased.is_empty() and expected.contributions.is_empty()): return false
		for transfer in transfers:
			if transfer.category == "contract_delivery":
				var definitions: Array = CampaignContracts.CAMPAIGN_CONTRACTS.filter(func(contract): return contract.location == franchise.id)
				var index := JS.find_index(definitions, func(contract): return contract.id == transfer.payload.get("contractId"))
				if index < 0: return false
				var contract: Dictionary = definitions[index]
				var completed: Array = JS.get_or(expected, "completedContracts", [])
				if transfer.amountMinor != 0 or completed.has(contract.id) or not definitions.slice(0, index).all(func(previous): return completed.has(previous.id)): return false
				if not contract.products.all(func(product): return MartCampaign.campaign_available_products(expected).has(product)) or transfer.payload.get("products") != contract.products: return false
				expected = JS.spread(expected, {"completedContracts": completed + [contract.id]})
				continue
			if transfer.category == "player_progress":
				var deltas = transfer.payload.get("deltas")
				if transfer.amountMinor != 0 or not deltas is Dictionary or deltas.is_empty(): return false
				for key in deltas:
					if not CampaignTasks.CAMPAIGN_TASK_IDS.has(key) or not JS.is_safe_integer(deltas[key]) or deltas[key] <= 0 or deltas[key] > CampaignTasks.campaign_task_target(key, franchise.id): return false
				var progress := CampaignTasks.add_campaign_task_progress(JS.get_or(expected, "personalProgress", {}), deltas, franchise.id)
				for key in deltas:
					if progress.get(key, 0) - JS.get_or(expected, "personalProgress", {}).get(key, 0) != deltas[key]: return false
				expected = JS.spread(expected, {"personalProgress": progress})
				continue
			var id = transfer.payload.get("purchaseId")
			if not id is String or not known.has(id) or not JS.is_safe_integer(transfer.amountMinor) or transfer.amountMinor >= 0: return false
			var result := PurchaseState.contribute_purchase(expected, id, current.countryCode, -transfer.amountMinor, -transfer.amountMinor)
			if result.spentMinor != -transfer.amountMinor or result.state.contributions.get(id) != transfer.payload.get("contributedMinor") or result.completedNow != transfer.payload.get("completed"): return false
			expected = result.state
		var actual: Dictionary = candidate.purchases
		if JS.get_or(actual, "completedContracts", []) != JS.get_or(expected, "completedContracts", []): return false
		var actual_progress: Dictionary = JS.get_or(actual, "personalProgress", {})
		for id in actual_progress:
			if not CampaignTasks.CAMPAIGN_TASK_IDS.has(id): return false
		for id in CampaignTasks.CAMPAIGN_TASK_IDS:
			if actual_progress.get(id, 0) != JS.get_or(expected, "personalProgress", {}).get(id, 0): return false
		if actual.version != 1 or actual.get("inherited") != expected.get("inherited") or actual.purchased != expected.purchased: return false
		for id in actual.contributions:
			if not known.has(id): return false
		for purchase in MartCampaign.OPENING_PURCHASES:
			if actual.contributions.get(purchase.id) != expected.contributions.get(purchase.id): return false
	return true

static func _campaign_openings_are_conserved(current: Dictionary, next: Dictionary, events: Array) -> bool:
	if not current.franchises.any(func(franchise): return franchise.owned and franchise.get("purchases") != null): return true
	var cursor := current.duplicate(true)
	for event in events:
		var franchise = JS.find(cursor.franchises, func(item): return item.id == event.franchiseId)
		if franchise == null: return false
		if event.category == "capital":
			var quote := CampaignExpansion.campaign_expansion_quote(cursor, franchise.id)
			if event.payload.get("campaignOpening") != true or not quote.available or event.amountMinor != -quote.costMinor or franchise.get("purchases") == null: return false
			franchise.owned = true
		elif ["purchase", "player_progress", "contract_delivery"].has(event.category):
			if not franchise.owned or franchise.get("purchases") == null: return false
			if event.category == "contract_delivery": franchise.purchases.completedContracts = JS.get_or(franchise.purchases, "completedContracts", []) + [event.payload.contractId]
			elif event.category == "player_progress": franchise.purchases.personalProgress = CampaignTasks.add_campaign_task_progress(JS.get_or(franchise.purchases, "personalProgress", {}), event.payload.deltas, franchise.id)
			else: franchise.purchases = PurchaseState.contribute_purchase(franchise.purchases, event.payload.purchaseId, current.countryCode, -event.amountMinor, -event.amountMinor).state
	for franchise in cursor.franchises:
		var candidate = JS.find(next.franchises, func(item): return item.id == franchise.id)
		if candidate == null or candidate.owned != franchise.owned: return false
	return true

static func _has_invalid_carry(input: Variant) -> bool:
	if not input is Dictionary: return true
	var capacity = input.get("capacity")
	if not JS.is_safe_integer(capacity) or capacity < 1 or capacity > CarrySystem.MAX_WAREHOUSE_PICKUP_BATCH: return true
	var items = input.get("items")
	if not items is Dictionary: return true
	var total = 0
	for product in items:
		var quantity = items[product]
		if not ProductRegistry.is_product_id(product) or not JS.is_safe_integer(quantity) or quantity < 0 or quantity > 1000000: return true
		total += quantity
	return total > capacity

static func _valid_tier(value: Variant) -> bool:
	return JS.is_safe_integer(value) and value >= 1 and value <= 10

static func _progression_is_monotonic(current: Dictionary, next: Dictionary) -> bool:
	if next.progression.playerActionCount < current.progression.playerActionCount: return false
	for level in current.progression.completedLevels:
		if not next.progression.completedLevels.has(level): return false
	for key in current.progression.counters:
		if next.progression.counters.get(key, 0) < current.progression.counters[key]: return false
	return true

static func _positive_events_are_plausible(current: Dictionary, next: Dictionary, events: Array) -> bool:
	var country: Dictionary = Catalog.COUNTRIES[next.countryCode]
	var scale: float = float(country.startingCapitalMinor) / Catalog.COUNTRIES.ES.startingCapitalMinor
	var max_price = JS.max_of(Catalog.PRODUCTS.values().map(func(product): return product.saleMinor))
	var max_sale := ceili(max_price * scale * 1.18 * (1 + country.salesTaxRate) * 15 * CampaignLevels.campaign_price_multiplier(30))
	for event in events:
		if event.amountMinor <= 0: continue
		if event.category == "sales":
			if event.amountMinor > max_sale or not event.payload.get("transactionId") is String: return false
			continue
		if event.category == "mission":
			for state in [current, next]:
				if state.franchises.any(func(franchise): return franchise.owned and franchise.get("purchases") != null): return false
			var mission = JS.find(current.missions + next.missions, func(candidate): return candidate.id == event.payload.get("missionId"))
			if mission == null or event.amountMinor != mission.rewardMinor: return false
			continue
		if event.category == "configuration":
			if not (current.tutorialStep == 0 and event.payload.get("countryCode") == next.countryCode and next.balanceMinor <= country.startingCapitalMinor and event.amountMinor == country.startingCapitalMinor - current.balanceMinor): return false
			continue
		return false
	return true
