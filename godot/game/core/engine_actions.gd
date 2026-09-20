class_name EngineActions
extends RefCounted
const P = preload("res://game/core/engine_progression.gd")
const Day = preload("res://game/core/engine_day.gd")
const Checkout = preload("res://game/core/engine_checkout.gd")
const Money = preload("res://game/core/money_format.gd")

static func can_order_product(state: Dictionary, product_id: String) -> bool:
	var franchise := P.current_franchise(state)
	if franchise.get("purchases") != null: return product_id in MartCampaign.campaign_available_products(franchise.purchases)
	if product_id == "cannedCorn": return false
	var supplier = P.find_id(Catalog.SUPPLIERS, Catalog.PRODUCTS[product_id].supplier)
	return supplier != null and supplier.unlockLevel <= state.level

static func shelf_capacity(franchise: Dictionary, product: String) -> int:
	return RetailLayout.retail_shelf_capacity_for_tier(franchise.stationTiers.get("shelves-1", franchise.shelvesLevel), product, franchise.unlockedAreas)

static func can_operate_machine(franchise: Dictionary, machine_id: String, now: float) -> bool:
	var source = P.find_id(franchise.productionMachines, machine_id)
	if source == null or source.status == "LOCKED": return false
	var machine := StationSystem.update_machine(source, now)
	var animal = FedAnimal.animal_production(machine.productId, machine.tier)
	if animal != null and CarrySystem.carry_quantity(franchise.carry, animal.input) > 0 and StationSystem.chicken_feed_status(machine).free > 0: return true
	if animal == null:
		for product in Products.PRODUCT_CONFIG.get(machine.productId, {}).get("recipe", {}):
			if CarrySystem.carry_quantity(franchise.carry, product) > 0 and StationSystem.machine_input_room(machine, product) > 0: return true
	return machine.output > 0 and CarrySystem.carry_total(franchise.carry) < franchise.carry.capacity

static func operate_machine(state: Dictionary, franchise: Dictionary, id: String, ingredient: String, success: Callable, fail: Callable) -> Dictionary:
	var index := -1
	for i in franchise.productionMachines.size():
		if franchise.productionMachines[i].id == id:
			index = i
			break
	if index < 0: return fail.call("La estación todavía no está construida.")
	var source: Dictionary = franchise.productionMachines[index]
	var machine := StationSystem.update_machine(source, state.simulationTimeMs)
	var commit := func(next: Dictionary):
		var produced: int = maxi(0, machine.output - source.output)
		if produced > 0:
			P.record_domain(state, "production:%s" % machine.productId, produced)
			P.record_domain(state, "production:all", produced)
			P.gain(state, 24 * produced, "production", produced)
		franchise.productionMachines[index] = next
	var animal = FedAnimal.animal_production(machine.productId, machine.tier)
	if animal != null and CarrySystem.carry_quantity(franchise.carry, animal.input) > 0 and StationSystem.chicken_feed_status(machine).free > 0:
		var inventory := ProductRegistry.create_empty_inventory()
		inventory[animal.input] = CarrySystem.carry_quantity(franchise.carry, animal.input)
		var loaded := StationSystem.load_machine(machine, inventory, state.simulationTimeMs)
		if loaded.loaded:
			var consumed: int = inventory[animal.input] - loaded.inventory[animal.input]
			franchise.carry = CarrySystem.remove_from_carry(franchise.carry, animal.input, consumed).container
			commit.call(loaded.machine)
			P.record_domain(state, "feed:%s" % animal.species, consumed)
			return success.call("Llevaste %d × %s al comedero." % [consumed, Catalog.PRODUCTS[animal.input].name.to_lower()])
	var carried := CarrySystem.carry_quantity(franchise.carry, ingredient)
	if carried > 0 and StationSystem.machine_input_room(machine, ingredient) > 0:
		var inventory := ProductRegistry.create_empty_inventory()
		inventory[ingredient] = carried
		var loaded := StationSystem.load_machine(machine, inventory, state.simulationTimeMs)
		var consumed: int = carried - loaded.inventory[ingredient]
		franchise.carry = CarrySystem.remove_from_carry(franchise.carry, ingredient, consumed).container
		commit.call(loaded.machine)
		var queued: int = StationSystem.machine_queued_cycles(loaded.machine) + int(loaded.machine.status == "PROCESSING")
		return success.call("Cargaste %d × %s: %d %s de %s en cola." % [consumed, Catalog.PRODUCTS[ingredient].name.to_lower(), queued, "ciclo" if queued == 1 else "ciclos", Catalog.PRODUCTS[machine.productId].name.to_lower()])
	if machine.output > 0:
		var free: int = maxi(0, franchise.carry.capacity - CarrySystem.carry_total(franchise.carry))
		if free < 1: return fail.call("La cesta está llena.")
		var collected := StationSystem.collect_machine_output_batch(machine, state.simulationTimeMs, free)
		commit.call(collected.machine)
		franchise.carry = CarrySystem.add_to_carry(franchise.carry, machine.productId, collected.collected, collected.collected).container
		P.record_domain(state, "collect:%s" % machine.productId, collected.collected)
		return success.call("Recogiste %d × %s terminado." % [collected.collected, Catalog.PRODUCTS[machine.productId].name.to_lower()])
	if carried > 0: return fail.call("La cola de %s está llena." % Catalog.PRODUCTS[machine.productId].name.to_lower())
	return fail.call("Faltan ingredientes para %s." % Catalog.PRODUCTS[machine.productId].name.to_lower())

static func apply_game_action(input: Dictionary, action: Dictionary, clone_input: bool = true, finalize: bool = true) -> Dictionary:
	var state: Dictionary = input.duplicate(true) if clone_input else input
	var events: Array = []
	var counters_before: Dictionary = state.progression.counters.duplicate()
	var franchise := P.current_franchise(state)
	var fail := func(message: String) -> Dictionary: return {"state": input, "ok": false, "message": message, "events": []}
	var success := func(message: String) -> Dictionary:
		if action.type in P.COUNTS_AS_PLAYER_PROGRESS: P.attribute_player_action(state, action, counters_before)
		if franchise.get("purchases") != null:
			var before: Dictionary = JS.get_or(franchise.purchases, "personalProgress", {})
			var deltas := {}
			for id in CampaignTasks.CAMPAIGN_TASK_IDS:
				var delta: float = state.progression.counters.get(id, 0) - counters_before.get(id, 0)
				if delta > 0: deltas[id] = delta
			var after := CampaignTasks.add_campaign_task_progress(before, deltas, franchise.id)
			var applied := {}
			for id in CampaignTasks.CAMPAIGN_TASK_IDS:
				if after.get(id, 0) > before.get(id, 0): applied[id] = after[id] - before.get(id, 0)
			if not applied.is_empty():
				franchise.purchases.personalProgress = after
				events.append({"franchiseId": franchise.id, "category": "player_progress", "description": "Trabajo personal en la campaña", "amountMinor": 0, "payload": {"deltas": applied}})
		if finalize:
			if action.type in P.COUNTS_AS_PLAYER_PROGRESS: state.progression.playerActionCount += 1
			state.revision += 1
			P.normalize_level(state)
			Day.stamp_events(state, events)
		return {"state": state, "ok": true, "message": message, "events": events}
	match action.type:
		"DELIVER_CONTRACT":
			var contract = P.find_id(CampaignContracts.campaign_contracts(franchise), action.contractId)
			if not franchise.owned or franchise.get("purchases") == null or contract == null: return fail.call("Este encargo no pertenece a tu local.")
			if contract.completed: return fail.call("Ya entregaste este encargo.")
			if not contract.previousDone: return fail.call("Completa primero el encargo anterior.")
			if not contract.unlocked: return fail.call("Desbloquea todos los productos del encargo.")
			if not contract.ready: return fail.call("Reúne una unidad de cada producto en tu cesta personal.")
			for product in contract.products: franchise.carry = CarrySystem.remove_from_carry(franchise.carry, product, 1).container
			franchise.purchases.completedContracts = JS.get_or(franchise.purchases, "completedContracts", []).duplicate() + [contract.id]
			events.append({"franchiseId": franchise.id, "category": "contract_delivery", "description": contract.label, "amountMinor": 0, "payload": {"contractId": contract.id, "products": contract.products.duplicate()}})
			return success.call("Entregado: %s. Encargo personal completado." % contract.label)
		"CONTRIBUTE_PURCHASE":
			if franchise.get("purchases") == null: return fail.call("La nueva campaña empieza desde nivel 1; no se transfieren compras de la partida anterior.")
			var before := PurchaseState.purchase_quote(franchise.purchases, action.purchaseId, state.countryCode)
			for task in before.tasks:
				if not task.completed: return fail.call("Falta trabajo personal: %s (%d/%d)." % [task.label, task.progress, task.target])
			var result := PurchaseState.contribute_purchase(franchise.purchases, action.purchaseId, state.countryCode, state.balanceMinor, JS.get_or(action, "amountMinor", PurchaseState.purchase_contribution_pulse_minor(JS.get_or(before, "costMinor", 0))))
			if not result.spentMinor: return fail.call("Compra no disponible o sin dinero recogido para aportar.")
			franchise.purchases = result.state
			P.unlock_area(franchise, "purchase-campaign")
			state.balanceMinor -= result.spentMinor
			franchise.expensesTodayMinor += result.spentMinor
			if result.completedNow: P.apply_purchase_content(state, franchise, action.purchaseId)
			var quote := PurchaseState.purchase_quote(result.state, action.purchaseId, state.countryCode)
			events.append({"franchiseId": franchise.id, "category": "purchase", "description": "Aporte: %s" % quote.label, "amountMinor": -result.spentMinor, "payload": {"purchaseId": action.purchaseId, "contributedMinor": quote.contributedMinor, "completed": result.completedNow}})
			return success.call("%s: desbloqueado." % quote.label if result.completedNow else "%s: faltan %s." % [quote.label, Money.format_money(quote.remainingMinor, state)])
		"COLLECT_REGISTER":
			if not CheckoutLayout.is_checkout_lane(action.lane): return fail.call("Caja desconocida.")
			var amount: Variant = franchise.registerCashMinor[action.lane]
			if not JS.is_safe_integer(amount) or amount <= 0: return fail.call("No hay dinero pendiente en esta caja.")
			if not JS.is_safe_integer(state.balanceMinor + amount): return fail.call("No se puede recoger este importe.")
			franchise.registerCashMinor[action.lane] = 0
			state.balanceMinor += amount
			P.record_domain(state, "player:collect-register", 1)
			events.append({"franchiseId": franchise.id, "category": "cash_collection", "description": "Recogida de caja %d" % (action.lane + 1), "amountMinor": 0, "payload": {"lane": action.lane, "collectedMinor": amount}})
			return success.call("Dinero de la caja recogido.")
		"SET_COUNTRY":
			if state.countryCode != action.countryCode and state.franchises.any(func(item): return item.get("purchases") != null and (not item.purchases.purchased.is_empty() or not item.purchases.contributions.is_empty())): return fail.call("El país queda fijado al realizar la primera compra.")
			if state.day > 1 or state.finances.grossRevenueMinor > 0: return fail.call("El país fiscal queda fijado al iniciar la empresa.")
			var balance_before: int = state.balanceMinor
			var country: Dictionary = Catalog.COUNTRIES[action.countryCode]
			var ratio: float = float(country.startingCapitalMinor) / Catalog.COUNTRIES[state.countryCode].startingCapitalMinor
			state.countryCode = country.code
			state.currency = country.currency
			state.balanceMinor = JS.round(state.balanceMinor * ratio)
			for item in state.franchises:
				item.purchaseCostMinor = JS.round(item.purchaseCostMinor * ratio)
				for project in item.buildProjects:
					project.costMinor = JS.round(project.costMinor * ratio)
					project.contributedMinor = JS.round(project.contributedMinor * ratio)
			for item in state.missions: item.rewardMinor = JS.round(item.rewardMinor * ratio)
			state.tutorialStep = 1
			events.append({"franchiseId": Day.global_event_franchise_id(state), "category": "configuration", "description": "Capital inicial convertido a %s" % country.currency, "amountMinor": state.balanceMinor - balance_before, "payload": {"scope": "global", "countryCode": country.code}})
			return success.call("Empresa registrada en %s." % country.name)
		"SET_AVATAR":
			for key in ["body", "hair", "hairColor", "skin", "shirt", "hat"]:
				if key in action: state.avatar[key] = action[key]
			return success.call("Avatar actualizado.")
		"TOGGLE_STORE":
			if franchise.get("purchases") == null and not franchise.licenseActive: return fail.call("Necesitas una licencia comercial activa.")
			if franchise.open: return success.call(Day.begin_business_day_closure(state, events))
			if BusinessDay.business_day_is_closing(state.minuteOfDay): return fail.call("La jornada está cerrando; primero deben salir los últimos clientes.")
			franchise.open = true
			franchise.lightsOn = true
			return success.call("Tienda abierta: ¡a trabajar!")
		"TEND_CROP", "HARVEST":
			var objective: String = "wheat" if state.level == 5 else ("corn" if state.level == 11 else "")
			var matches := func(crop): return (not action.get("cropId") or crop.id == action.cropId) and (not action.get("productId") or crop.productId == action.productId)
			var index := -1
			for i in franchise.crops.size():
				var candidate := StationSystem.update_crop(franchise.crops[i], state.simulationTimeMs)
				if candidate.status != "READY" or not matches.call(candidate): continue
				if index == -1 or (candidate.productId == objective and franchise.crops[index].productId != objective): index = i
			if index < 0:
				if action.type == "TEND_CROP":
					for i in franchise.crops.size():
						if franchise.crops[i].status != "EMPTY" or not matches.call(franchise.crops[i]): continue
						var planted := StationSystem.plant_crop(franchise.crops[i], state.simulationTimeMs, state.level)
						franchise.crops[i] = planted.crop
						if planted.planted:
							P.record_domain(state, "plant:%s" % planted.crop.productId, 1)
							P.gain(state, 8, "harvest", 0)
							return success.call("%s empezó a crecer automáticamente." % Catalog.PRODUCTS[planted.crop.productId].name)
						break
				for crop in franchise.crops:
					if crop.status == "GROWING" and matches.call(crop): return fail.call("%s: creciendo, faltan %d s." % [Catalog.PRODUCTS[crop.productId].name, maxi(1, ceili((crop.readyAt - state.simulationTimeMs) / 1000.0))])
				return fail.call("Todavía no hay un cultivo listo.")
			var crop := StationSystem.update_crop(franchise.crops[index], state.simulationTimeMs)
			var free: int = maxi(0, franchise.carry.capacity - CarrySystem.carry_total(franchise.carry))
			if free < 1: return fail.call("La cesta está llena.")
			var raw: Variant = JS.get_or(action, "quantity", 1) if action.type == "HARVEST" else 1
			var requested: int = maxi(0, floori(raw)) if JS.is_finite_number(raw) else 0
			var limit: int = mini(requested, mini(crop.available, free))
			if limit < 1: return fail.call("Todavía no hay un cultivo listo.")
			var harvest := StationSystem.harvest_crop_batch(crop, state.simulationTimeMs, limit, state.level)
			if harvest.harvested < 1: return fail.call("Todavía no hay un cultivo listo.")
			franchise.crops[index] = harvest.crop
			franchise.carry = CarrySystem.add_to_carry(franchise.carry, crop.productId, harvest.harvested, harvest.harvested).container
			P.record_domain(state, "harvest:%s" % crop.productId, harvest.harvested)
			P.record_domain(state, "harvest:all", harvest.harvested)
			P.gain(state, 18 * harvest.harvested, "harvest", harvest.harvested)
			return success.call("Cosechaste %d × %s. El bancal ya está volviendo a crecer." % [harvest.harvested, Catalog.PRODUCTS[crop.productId].name.to_lower()] if harvest.crop.status == "GROWING" else "%s: cosechaste %d; quedan %d unidades maduras." % [Catalog.PRODUCTS[crop.productId].name, harvest.harvested, harvest.crop.available])
		"LOAD_FLOUR_MILL": return operate_machine(state, franchise, "flour-mill-1", "wheat", success, fail)
		"BAKE_BREAD": return operate_machine(state, franchise, "bread-oven-1", "flour", success, fail)
		"OPERATE_MACHINE":
			var machine = P.find_id(franchise.productionMachines, action.machineId)
			if machine == null or machine.status == "LOCKED": return fail.call("La estación todavía no está desbloqueada.")
			var ingredients: Array = Products.PRODUCT_CONFIG.get(machine.productId, {}).get("recipe", {}).keys()
			if ingredients.is_empty() and machine.output < 1: return fail.call("La estación sigue produciendo.")
			return operate_machine(state, franchise, machine.id, machine.productId if ingredients.is_empty() else ingredients[0], success, fail)
		"PICKUP_WAREHOUSE":
			if CarrySystem.carry_total(franchise.carry) >= franchise.carry.capacity: return fail.call("La cesta está llena.")
			var transfer := CarrySystem.transfer_warehouse_to_carry(franchise.warehouse, franchise.carry, action.get("quantity"), action.get("productId"))
			if transfer.moved < 1: return fail.call("No hay %s disponible en el almacén." % Catalog.PRODUCTS[action.productId].name.to_lower() if action.get("productId") else "No hay mercancía disponible en el almacén.")
			franchise.warehouse = transfer.warehouse
			franchise.carry = transfer.container
			var summary: Array[String] = []
			P.record_domain(state, "pickup:warehouse", transfer.moved)
			for product in transfer.movedByProduct:
				var quantity: int = transfer.movedByProduct[product]
				if quantity <= 0: continue
				summary.append("%d × %s" % [quantity, Catalog.PRODUCTS[product].name.to_lower()])
				P.record_domain(state, "pickup:%s" % product, quantity)
			return success.call("Cargaste %s desde el almacén." % ", ".join(summary))
		"RETURN_TO_WAREHOUSE":
			var carried := {}
			for product in franchise.carry.items:
				var raw: Variant = franchise.carry.items[product]
				var quantity: int = maxi(0, floori(raw)) if JS.is_finite_number(raw) else 0
				if quantity > 0: carried[product] = quantity
			if carried.is_empty(): return fail.call("La cesta está vacía.")
			var returned := 0
			var summary: Array[String] = []
			for product in carried:
				franchise.warehouse[product] += carried[product]
				returned += carried[product]
				P.record_domain(state, "return:%s" % product, carried[product])
				summary.append("%d × %s" % [carried[product], Catalog.PRODUCTS[product].name.to_lower()])
			P.record_domain(state, "return:warehouse", returned)
			franchise.carry = {"capacity": franchise.carry.capacity, "items": {}}
			return success.call("Devolviste al almacén: %s." % ", ".join(summary))
		"STOCK":
			if action.productId == "cannedCorn" and (franchise.get("purchases") == null or "preserves-supply-1" not in franchise.purchases.purchased): return fail.call("Desbloquea primero el expositor de conservas.")
			var capacity := shelf_capacity(franchise, action.productId)
			var raw: Variant = JS.get_or(action, "quantity", 1)
			var requested: int = maxi(0, floori(raw)) if JS.is_finite_number(raw) else 0
			var quantity := 0
			if action.get("source") == "carry":
				var transfer := CarrySystem.transfer_carry_to_shelf(franchise.carry, action.productId, franchise.shelves[action.productId], capacity, requested)
				franchise.carry = transfer.container
				franchise.shelves[action.productId] = transfer.shelfQuantity
				quantity = transfer.moved
			else: quantity = maxi(0, mini(requested, mini(franchise.warehouse[action.productId], capacity - franchise.shelves[action.productId])))
			if quantity <= 0: return fail.call("No puedes surtir más %s ahora." % Catalog.PRODUCTS[action.productId].name.to_lower())
			if action.get("source") != "carry":
				franchise.warehouse[action.productId] -= quantity
				franchise.shelves[action.productId] += quantity
			P.record_domain(state, "stock:%s" % action.productId, quantity)
			P.record_domain(state, "stock:all", quantity)
			P.record_domain(state, "transport:all", quantity)
			P.gain(state, 12 * quantity, "stock", quantity)
			return success.call("Colocaste %d × %s." % [quantity, Catalog.PRODUCTS[action.productId].name])
		"CHECKOUT":
			if not franchise.open: return fail.call("Abre la tienda antes de cobrar.")
			var transaction: Variant = null
			for candidate in franchise.checkoutTransactions:
				if candidate.state not in ["COMPLETE", "ABANDONED"]:
					transaction = candidate
					break
			if transaction == null: return fail.call("Todavía no hay un cliente listo en caja.")
			transaction.paymentMethod = action.paymentMethod
			transaction.handledByPlayer = true
			return success.call(Checkout.process_checkout_unit(state, franchise, transaction, events))
		"ORDER":
			var product: Dictionary = Catalog.PRODUCTS[action.productId]
			var supplier = P.find_id(Catalog.SUPPLIERS, action.supplierId)
			if supplier == null or not can_order_product(state, action.productId) or product.supplier != supplier.id: return fail.call("Proveedor no disponible para ese producto.")
			var quantity: int = clampi(floori(action.quantity), 1, 100)
			var total := JS.round(product.wholesaleMinor * GameFactory.country_money_scale(state.countryCode) * quantity * (1 - supplier.discount))
			if state.balanceMinor < total: return fail.call("No hay caja suficiente para este pedido.")
			state.balanceMinor -= total
			franchise.expensesTodayMinor += total
			state.finances.costOfGoodsMinor += total
			state.pendingOrders.append({"id": JS.uuid(), "franchiseId": franchise.id, "supplierId": supplier.id, "productId": action.productId, "quantity": quantity, "totalMinor": total, "arrivesAtMinute": state.minuteOfDay + supplier.leadMinutes})
			P.record_domain(state, "orders", 1)
			P.record_domain(state, "order:%s" % action.productId, 1)
			events.append({"franchiseId": franchise.id, "category": "inventory", "description": "Pedido de %s" % product.name, "amountMinor": -total})
			return success.call("Pedido confirmado. Entrega en %d min del juego." % supplier.leadMinutes)
		"HIRE":
			var info: Dictionary = Catalog.ROLE_INFO[action.role]
			if not P.can_hire_employee(state, action.role): return fail.call("Completa la compra o la cadena de este empleado primero." if franchise.get("purchases") != null else "Se desbloquea en nivel %d." % info.unlockLevel)
			var quote := GameFactory.employee_hiring_quote(action.role, state.countryCode)
			if state.balanceMinor < quote.signingCostMinor: return fail.call("Falta caja para contratación y alta.")
			state.balanceMinor -= quote.signingCostMinor
			franchise.expensesTodayMinor += quote.signingCostMinor
			var employee := P.employee(franchise, action.role, state.countryCode, state.simulationTimeMs, JS.uuid(), 1)
			franchise.employees.append(employee)
			P.ensure_checkouts_for_cashiers(franchise)
			events.append({"franchiseId": franchise.id, "category": "payroll", "description": "Alta de %s (%s)" % [employee.name, info.name], "amountMinor": -quote.signingCostMinor})
			P.gain(state, 55, "stock", 0)
			return success.call("%s se incorporó como %s." % [employee.name, info.name.to_lower()])
		"UPGRADE":
			if franchise.get("purchases") != null and (action.upgrade == "expansion" or (action.upgrade == "mill" and "flour-mill-1" not in franchise.purchases.purchased) or (action.upgrade == "bakery" and "bread-oven-1" not in franchise.purchases.purchased)): return fail.call("Desbloquea esta instalación mediante las compras del supermercado.")
			var tiers := {"shelves": franchise.shelvesLevel, "checkout": franchise.checkoutLevel, "expansion": franchise.expansionLevel, "mill": franchise.machines.flourMillLevel, "bakery": franchise.machines.bakeryLevel}
			var builder: bool = franchise.employees.any(func(employee): return employee.role == "builder")
			var cost := JS.round(55000 * GameFactory.country_money_scale(state.countryCode) * pow(tiers[action.upgrade], 1.65) * (0.82 if builder else 1))
			if state.balanceMinor < cost: return fail.call("Caja insuficiente para constructores y mobiliario.")
			state.balanceMinor -= cost
			franchise.expensesTodayMinor += cost
			match action.upgrade:
				"shelves": franchise.shelvesLevel += 1
				"checkout": franchise.checkoutLevel += 1
				"expansion": franchise.expansionLevel += 1
				"mill": franchise.machines.flourMillLevel += 1
				"bakery": franchise.machines.bakeryLevel += 1
			events.append({"franchiseId": franchise.id, "category": "capital", "description": "Obra y mejora: %s" % action.upgrade, "amountMinor": -cost})
			P.gain(state, 80, "production", 0)
			return success.call("Constructores terminaron la mejora.")
		"CONTRIBUTE_BUILD":
			if franchise.get("purchases") != null: return fail.call("Esta tienda avanza mediante sus compras y expansiones, no pagando niveles.")
			var project: Variant = null
			for candidate in franchise.buildProjects:
				if candidate.level == state.level + 1 and not candidate.completed:
					project = candidate
					break
			if project == null: return fail.call("La tienda ya alcanzó el rango máximo." if state.level >= 30 else "No hay una ampliación disponible ahora.")
			var pulse: int = maxi(1, JS.round(JS.get_or(action, "amountMinor", 500 * GameFactory.country_money_scale(state.countryCode))))
			var contribution: int = mini(pulse, mini(state.balanceMinor, project.costMinor - project.contributedMinor))
			if contribution <= 0: return fail.call("No hay caja disponible para continuar la obra.")
			state.balanceMinor -= contribution
			franchise.expensesTodayMinor += contribution
			project.contributedMinor += contribution
			project.completed = project.contributedMinor >= project.costMinor
			events.append({"franchiseId": franchise.id, "category": "capital", "description": "Aporte ampliación nivel %d" % project.level, "amountMinor": -contribution, "payload": {"projectId": project.id, "contributedMinor": project.contributedMinor}})
			if project.completed and Objectives.level_objective_satisfied(state.level, state): return success.call("Ampliación completada. Nivel %d desbloqueado." % project.level)
			return success.call("Financiación completa; falta terminar el objetivo del nivel." if project.completed else "Aporte confirmado. Faltan %s para completar la obra." % Money.format_money(project.costMinor - project.contributedMinor, state))
		"UPGRADE_ROSTER":
			var entry = P.find_id(RosterUpgrades.roster_entries(franchise, GameFactory.country_money_scale(state.countryCode)), action.entryId)
			if entry == null: return fail.call("Esa ficha ya no está en tu equipo.")
			if entry.nextCostMinor == null: return fail.call("Ya tiene las cuatro mejoras.")
			if state.balanceMinor < entry.nextCostMinor: return fail.call("Faltan %s para esta mejora." % Money.format_money(entry.nextCostMinor - state.balanceMinor, state))
			state.balanceMinor -= entry.nextCostMinor
			franchise.expensesTodayMinor += entry.nextCostMinor
			P.apply_roster_upgrade(franchise, entry)
			events.append({"franchiseId": franchise.id, "category": "upgrade", "description": "Mejora %s (%d/4)" % [entry.label, entry.step + 1], "amountMinor": -entry.nextCostMinor})
			return success.call("%s: mejora %d de 4 aplicada." % [entry.label, entry.step + 1])
		"CONTRIBUTE_UPGRADE":
			var target = P.upgrade_target(state, franchise, action.upgrade)
			if target == null: return fail.call(P.upgrade_unavailable_message(action.upgrade, franchise.get("purchases") != null))
			var cost := P.upgrade_cost_minor(state, target.currentTier, action.upgrade)
			var key := "%s:%s:%d" % [action.upgrade, target.id, target.currentTier + 1]
			var contributed: int = franchise.upgradeContributions.get(key, 0)
			var pulse: int = maxi(1, JS.round(JS.get_or(action, "amountMinor", 350 * GameFactory.country_money_scale(state.countryCode))))
			var contribution: int = mini(pulse, mini(state.balanceMinor, cost - contributed))
			if contribution <= 0: return fail.call("No hay caja disponible para continuar esta mejora.")
			state.balanceMinor -= contribution
			franchise.expensesTodayMinor += contribution
			var total: int = contributed + contribution
			franchise.upgradeContributions[key] = total
			events.append({"franchiseId": franchise.id, "category": "upgrade", "description": "Aporte %s" % target.label, "amountMinor": -contribution, "payload": {"key": key, "contributedMinor": total, "costMinor": cost}})
			if total >= cost:
				P.apply_upgrade_target(state, franchise, target)
				franchise.upgradeContributions.erase(key)
				return success.call("%s: nivel %d completado." % [target.label, target.currentTier + 1])
			return success.call("%s: %d %% financiado." % [target.label, floori(float(total) / cost * 100)])
		"DOOR_SENSOR":
			franchise.doorPlayerPresent = action.active
			return success.call("Sensor de puerta activo." if action.active else "Umbral despejado.")
		"BUY_LICENSE":
			if franchise.get("purchases") != null: return fail.call("La licencia de campaña es permanente; no necesitas renovarla.")
			var cost := JS.round(24000 * GameFactory.country_money_scale(state.countryCode) * (1 + franchise.expansionLevel))
			if state.balanceMinor < cost: return fail.call("No hay caja para renovar la licencia.")
			state.balanceMinor -= cost
			franchise.licenseActive = true
			franchise.licenseDaysLeft += 14
			events.append({"franchiseId": franchise.id, "category": "license", "description": "Licencia comercial (14 días)", "amountMinor": -cost})
			return success.call("Licencia comercial renovada.")
		"BUY_FRANCHISE":
			var target = P.find_id(state.franchises, action.franchiseId)
			if target == null or target.owned: return fail.call("Franquicia no disponible.")
			var campaign := Day.is_campaign_game(state)
			if campaign:
				var quote := CampaignExpansion.campaign_expansion_quote(state, target.id)
				if not quote.available: return fail.call(quote.reason)
				if target.get("purchases") == null: return fail.call("El local no pertenece a esta campaña.")
			elif state.level < target.unlockLevel: return fail.call("Requiere nivel %d." % target.unlockLevel)
			if state.balanceMinor < target.purchaseCostMinor: return fail.call("Capital global insuficiente.")
			state.balanceMinor -= target.purchaseCostMinor
			target.owned = true
			target.licenseActive = true
			target.licenseDaysLeft = 7
			if not campaign: P.synchronize_franchise_progression(state, target)
			var event := {"franchiseId": target.id, "category": "capital", "description": "Apertura de %s" % target.name, "amountMinor": -target.purchaseCostMinor}
			if campaign: event.payload = {"campaignOpening": true}
			events.append(event)
			return success.call("%s ya forma parte de tu empresa." % target.name)
		"TRAVEL":
			var target = P.find_id(state.franchises, action.franchiseId)
			if target == null or not target.owned: return fail.call("Aún no eres dueño de esa franquicia.")
			franchise.businessDay = state.day
			franchise.businessMinute = state.minuteOfDay
			state.currentFranchiseId = target.id
			state.day = JS.get_or(target, "businessDay", 1)
			state.minuteOfDay = JS.get_or(target, "businessMinute", BusinessDay.BUSINESS_DAY_OPEN_MINUTE)
			return success.call("Viaje instantáneo a %s." % target.name)
		"CLAIM_MISSION":
			if Day.is_campaign_game(state): return fail.call("La campaña avanza con trabajo personal y ventas, sin bonos diarios.")
			var mission = P.find_id(state.missions, action.missionId)
			if mission == null or not mission.completed or mission.claimed: return fail.call("La misión todavía no se puede cobrar.")
			mission.claimed = true
			state.balanceMinor += mission.rewardMinor
			events.append({"franchiseId": Day.global_event_franchise_id(state), "category": "mission", "description": mission.label, "amountMinor": mission.rewardMinor, "payload": {"scope": "global", "missionId": mission.id}})
			return success.call("Recompensa ingresada en la caja global.")
		"CLOSE_DAY":
			if not state.franchises.any(func(candidate): return candidate.owned and candidate.open): return fail.call("La tienda ya está cerrada.")
			return success.call(Day.begin_business_day_closure(state, events))
	push_error("Unknown game action: %s" % action.type)
	return {}

static func advance_simulation(input: Dictionary, minutes: float = 10) -> Dictionary:
	var state := input.duplicate(true)
	var events: Array = []
	state.minuteOfDay += minutes
	P.current_franchise(state).businessMinute = state.minuteOfDay
	state.lastServerTime += minutes * 60000
	Day.deliver_orders(state)
	for franchise in state.franchises:
		if not franchise.owned or not franchise.open: continue
		for worker in franchise.employees: worker.energy = maxf(15, worker.energy - 0.15 * minutes)
	state.revision += 1
	P.normalize_level(state)
	Day.stamp_events(state, events)
	return {"state": state, "ok": true, "message": "Simulación actualizada.", "events": events}
