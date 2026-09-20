class_name EngineEmployees
extends RefCounted
const P = preload("res://game/core/engine_progression.gd")
const Paths = preload("res://game/core/engine_paths.gd")
const Actions = preload("res://game/core/engine_actions.gd")
const Checkout = preload("res://game/core/engine_checkout.gd")
const WAREHOUSE_PRODUCT_CAP = 2000
const SURPLUS_PRODUCTION_BATCH = 200

static func crop_point(id: String) -> Variant:
	for plot in FarmLayout.FARM_PLOTS:
		if plot.id == id: return [plot.position[0], plot.position[2]]
	return null

static func machine_point(id: String) -> Variant:
	if id in ProductionLayout.PRODUCTION_MACHINE_POINTS: return ProductionLayout.PRODUCTION_MACHINE_POINTS[id].duplicate()
	var names := {"chicken-coop-1": "chicken", "chicken-coop-2": "chicken2", "cow-station-1": "cow"}
	if id not in names: return null
	var point: Array = FarmLayout.FARM_ANIMAL_STATIONS[names[id]].workPosition
	return [point[0], point[2]]

static func barn_point() -> Array:
	return FarmLayout.FARM_BARN.workerPosition.duplicate()

static func saleable_products(state: Dictionary, franchise: Dictionary) -> Array:
	return MartCampaign.campaign_available_products(franchise.purchases) if franchise.get("purchases") != null else Objectives.unlocked_customer_products(state.level)

static func machine_ingredient(machine: Dictionary) -> Variant:
	var animal = FedAnimal.animal_production(machine.productId, machine.tier)
	if animal != null: return animal.input
	var ingredients: Array = Products.PRODUCT_CONFIG.get(machine.productId, {}).get("recipe", {}).keys()
	return null if ingredients.is_empty() else ingredients[0]

static func shelf_fill(franchise: Dictionary, product: String) -> float:
	return float(franchise.shelves[product]) / Actions.shelf_capacity(franchise, product)

static func planned_destination(state: Dictionary, franchise: Dictionary, product: String, chain: Array) -> Variant:
	var retail: bool = product in saleable_products(state, franchise) and shelf_fill(franchise, product) < 1
	if retail and franchise.shelves[product] == 0: return {"kind": "retail"}
	var consumer: Variant = null
	if chain.find(product) > 0:
		for machine in franchise.productionMachines:
			if machine.status != "LOCKED" and machine.productId in chain and machine_ingredient(machine) == product:
				consumer = machine
				break
	if consumer != null and StationSystem.machine_input_room(consumer, product) > 0: return {"kind": "machine", "machineId": consumer.id}
	if retail: return {"kind": "retail"}
	return {"kind": "warehouse"} if (not chain.is_empty() and product == chain[0]) or franchise.warehouse[product] < WAREHOUSE_PRODUCT_CAP else null

static func on_hand(franchise: Dictionary, product: String) -> int:
	var total: int = franchise.warehouse[product]
	for worker in franchise.employees:
		if worker.get("runtime") != null: total += JS.get_or(worker.runtime.carry.items, product, 0)
	for machine in franchise.productionMachines:
		if machine.productId == product: total += machine.output
	return total

static func manufactured(franchise: Dictionary, product: String) -> bool:
	return franchise.productionMachines.any(func(machine): return machine.productId == product and machine.status != "LOCKED")

static func store_supply_plan(franchise: Dictionary) -> Array:
	var products: Array = []
	for station in franchise.crops + franchise.productionMachines:
		if station.status != "LOCKED" and station.productId not in products: products.append(station.productId)
	var pending: Array = products.filter(func(id): return franchise.warehouse[id] < WAREHOUSE_PRODUCT_CAP)
	var pool: Array = products if pending.is_empty() else pending
	var ordered := pool.duplicate()
	# Godot's sort is not stable; original insertion index resolves TS stable ties.
	ordered.sort_custom(func(a, b):
		var difference: int = franchise.warehouse[a] - franchise.warehouse[b]
		if difference: return difference < 0
		var machine_difference: int = int(manufactured(franchise, b)) - int(manufactured(franchise, a))
		return machine_difference < 0 if machine_difference else pool.find(a) < pool.find(b))
	var emergency: Variant = null
	for id in ordered:
		if franchise.shelves[id] == 0 and on_hand(franchise, id) == 0:
			emergency = id
			break
	var focus: Variant = franchise.get("supplyFocus")
	if focus == null or focus.productId not in pool or franchise.warehouse[focus.productId] >= focus.target or (emergency != null and (franchise.shelves[focus.productId] > 0 or on_hand(franchise, focus.productId) > 0) and emergency != focus.productId):
		var product: Variant = emergency if emergency != null else (ordered[0] if not ordered.is_empty() else null)
		if product == null:
			franchise.erase("supplyFocus")
			return []
		var most := 1
		for id in products: most = maxi(most, franchise.warehouse[id])
		focus = {"productId": product, "target": mini(WAREHOUSE_PRODUCT_CAP, most) if not pending.is_empty() else franchise.warehouse[product] + SURPLUS_PRODUCTION_BATCH}
		if franchise.warehouse[product] >= focus.target: focus.target = franchise.warehouse[product] + 1
		franchise.supplyFocus = focus
	var chain: Array = []
	_visit_supply(franchise, focus.productId, chain)
	return chain

static func _visit_supply(franchise: Dictionary, id: String, chain: Array) -> void:
	if id in chain: return
	chain.append(id)
	for machine in franchise.productionMachines:
		if machine.productId != id or machine.status == "LOCKED": continue
		var animal = FedAnimal.animal_production(id, machine.tier)
		var ingredients: Array = [animal.input] if animal != null else Products.PRODUCT_CONFIG.get(id, {}).get("recipe", {}).keys()
		for ingredient in ingredients: _visit_supply(franchise, ingredient, chain)
		return

static func reserved_source_pickup(franchise: Dictionary, station: String, product: String, employee_id: String) -> int:
	var total := 0
	for worker in franchise.employees:
		var task: Variant = worker.get("runtime")
		if worker.id != employee_id and task != null and task.assignedStationId == station and task.assignedProduct == product and task.state in ["NAVIGATE_PICKUP", "PICKUP"]: total += maxi(0, task.carry.capacity - CarrySystem.carry_total(task.carry))
	return total

static func available_warehouse_for_employee(franchise: Dictionary, product: String, employee_id: String) -> int:
	var reserved := 0
	for worker in franchise.employees:
		if worker.id == employee_id: continue
		var runtime: Variant = worker.get("runtime")
		if runtime == null or runtime.assignedProduct != product or runtime.state not in ["NAVIGATE_PICKUP", "PICKUP"]: continue
		var machine: Variant = P.find_id(franchise.productionMachines, runtime.assignedStationId) if runtime.assignedStationId != null else null
		if runtime.assignedStationId != "stockroom" and (machine == null or machine.productId == product): continue
		reserved += runtime.carry.capacity
	return maxi(0, franchise.warehouse[product] - reserved)

static func assign_employee_task(state: Dictionary, franchise: Dictionary, employee: Dictionary, pathfinder: Callable = Callable()) -> bool:
	var runtime: Dictionary = employee.runtime
	var chain := store_supply_plan(franchise)
	var assign := func(product: String, station: String, point: Array) -> bool:
		runtime.assignedProduct = product
		runtime.assignedStationId = station
		Paths.set_customer_path(runtime, Paths.navigate_path(pathfinder, [runtime.x, runtime.z], point))
		return true
	var saleable := saleable_products(state, franchise)
	var demand: Array = saleable.filter(func(id): return shelf_fill(franchise, id) < 1)
	demand.sort_custom(func(a, b):
		var difference: float = shelf_fill(franchise, a) - shelf_fill(franchise, b)
		if difference != 0: return difference < 0
		var stock: int = franchise.warehouse[a] - franchise.warehouse[b]
		return stock < 0 if stock else saleable.find(a) < saleable.find(b))
	for product in demand:
		var incoming := 0
		for worker in franchise.employees:
			var task: Variant = worker.get("runtime")
			if worker.id == employee.id or task == null or task.assignedProduct != product: continue
			var source: bool = task.assignedStationId == "stockroom" or franchise.crops.any(func(crop): return crop.id == task.assignedStationId and crop.productId == product) or franchise.productionMachines.any(func(machine): return machine.id == task.assignedStationId and machine.productId == product)
			if (task.state in ["NAVIGATE_PICKUP", "PICKUP"] and source) or (task.state in ["NAVIGATE_DROPOFF", "DROPOFF"] and task.assignedStationId == "retail:%s" % product): incoming += JS.get_or(task.carry.items, product, task.carry.capacity)
		if incoming >= Actions.shelf_capacity(franchise, product) - franchise.shelves[product]: continue
		if available_warehouse_for_employee(franchise, product, employee.id) > 0: return assign.call(product, "stockroom", WarehouseLayout.STOCKROOM_POINT)
		var destination = planned_destination(state, franchise, product, chain)
		if destination == null or destination.kind != "retail": continue
		for machine in franchise.productionMachines:
			if machine.productId == product and machine.status != "LOCKED" and machine.output > reserved_source_pickup(franchise, machine.id, product, employee.id): return assign.call(product, machine.id, machine_point(machine.id))
		for crop in franchise.crops:
			if crop.productId == product and crop.status == "READY" and crop.available > reserved_source_pickup(franchise, crop.id, product, employee.id): return assign.call(product, crop.id, _crop_point_or_first(crop.id))
	for product in chain:
		for machine in franchise.productionMachines:
			if machine.productId != product or machine.status == "LOCKED": continue
			var reserved_output := 0
			for worker in franchise.employees:
				if worker.id != employee.id and worker.get("runtime") != null and worker.runtime.assignedStationId == machine.id and worker.runtime.assignedProduct == product: reserved_output += worker.runtime.carry.capacity
			if machine.output > reserved_output and planned_destination(state, franchise, product, chain) != null: return assign.call(product, machine.id, machine_point(machine.id))
			var policy = FedAnimal.animal_production(product, machine.tier)
			var ingredient = machine_ingredient(machine)
			if ingredient == null: continue
			var reserved_input := 0
			for worker in franchise.employees:
				if worker.id != employee.id and worker.get("runtime") != null and worker.runtime.assignedStationId == machine.id and worker.runtime.assignedProduct == ingredient: reserved_input += worker.runtime.carry.capacity
			if StationSystem.machine_input_room(machine, ingredient) > reserved_input and available_warehouse_for_employee(franchise, ingredient, employee.id) > 0 and (not manufactured(franchise, ingredient) or franchise.warehouse[ingredient] > franchise.warehouse[product]): return assign.call(ingredient, machine.id, barn_point() if policy != null else WarehouseLayout.STOCKROOM_POINT)
	var crops: Array = franchise.crops.filter(func(crop): return crop.status != "LOCKED" and crop.productId in chain and planned_destination(state, franchise, crop.productId, chain) != null)
	var original := crops.duplicate()
	crops.sort_custom(func(a, b):
		var readiness: int = int(b.status == "READY") - int(a.status == "READY")
		if readiness: return readiness < 0
		var duration: float = JS.to_number(a.readyAt) - JS.to_number(b.readyAt)
		return duration < 0 if duration else original.find(a) < original.find(b))
	var selected: Variant = null
	for crop in crops:
		if not franchise.employees.any(func(worker): return worker.id != employee.id and worker.get("runtime") != null and worker.runtime.assignedStationId == crop.id and worker.runtime.state != "NAVIGATE_DROPOFF"):
			selected = crop
			break
	if selected == null and not crops.is_empty(): selected = crops[0]
	if selected != null: return assign.call(selected.productId, selected.id, _crop_point_or_first(selected.id))
	if not chain.is_empty():
		for machine in franchise.productionMachines:
			if machine.productId == chain[0] and machine.status != "LOCKED": return assign.call(machine.productId, machine.id, machine_point(machine.id))
	return false

static func _crop_point_or_first(id: String) -> Array:
	var point = crop_point(id)
	return crop_point(FarmLayout.FARM_PLOTS[0].id) if point == null else point

static func reset_employee(employee: Dictionary, now: float) -> void:
	var runtime: Dictionary = employee.runtime
	runtime.state = "IDLE"
	runtime.stateSince = now
	runtime.assignedProduct = null
	runtime.assignedStationId = null
	runtime.carry.items = {}
	runtime.currentSpeed = 0

static func route_employee_to_returns(runtime: Dictionary, now: float, pathfinder: Callable = Callable()) -> void:
	runtime.state = "NAVIGATE_RETURN"
	runtime.stateSince = now
	runtime.assignedStationId = WarehouseLayout.WAREHOUSE_RETURN_STATION.obstacleId
	Paths.set_customer_path(runtime, Paths.navigate_path(pathfinder, [runtime.x, runtime.z], WarehouseLayout.WAREHOUSE_RETURN_STATION.workerPosition.duplicate()))

static func employee_pickup(state: Dictionary, franchise: Dictionary, employee: Dictionary, pathfinder: Callable = Callable()) -> void:
	var runtime: Dictionary = employee.runtime
	var product: Variant = runtime.assignedProduct
	if not product:
		reset_employee(employee, state.simulationTimeMs)
		return
	var machine: Variant = P.find_id(franchise.productionMachines, runtime.assignedStationId) if runtime.assignedStationId != null else null
	var crop_index := -1
	for index in franchise.crops.size():
		if franchise.crops[index].id == runtime.assignedStationId:
			crop_index = index
			break
	var ingredient_trip: bool = machine != null and machine.productId != product
	var chain := store_supply_plan(franchise)
	if ingredient_trip and machine.productId not in chain:
		reset_employee(employee, state.simulationTimeMs)
		return
	var destination: Variant = null
	if runtime.assignedStationId == "stockroom" or ingredient_trip:
		var room: int = StationSystem.machine_input_room(machine, product) if ingredient_trip else Actions.shelf_capacity(franchise, product) - franchise.shelves[product]
		var quantity: int = maxi(0, mini(runtime.carry.capacity - CarrySystem.carry_total(runtime.carry), mini(room, franchise.warehouse[product])))
		franchise.warehouse[product] -= quantity
		runtime.carry.items = {product: quantity} if quantity else {}
	elif machine != null or crop_index >= 0:
		if crop_index >= 0 and product not in chain and shelf_fill(franchise, product) >= 1:
			reset_employee(employee, state.simulationTimeMs)
			return
		destination = planned_destination(state, franchise, product, chain)
		if destination == null:
			reset_employee(employee, state.simulationTimeMs)
			return
		var free: int = maxi(0, runtime.carry.capacity - CarrySystem.carry_total(runtime.carry))
		var limit: int = mini(free, WAREHOUSE_PRODUCT_CAP - franchise.warehouse[product]) if destination.kind == "warehouse" and (chain.is_empty() or product != chain[0]) else free
		if machine != null:
			var result := StationSystem.collect_machine_output_batch(machine, state.simulationTimeMs, limit)
			machine.merge(result.machine, true)
			runtime.carry = CarrySystem.add_to_carry(runtime.carry, product, result.collected, result.collected).container
		else:
			if franchise.crops[crop_index].status == "EMPTY": franchise.crops[crop_index] = StationSystem.plant_crop(franchise.crops[crop_index], state.simulationTimeMs, state.level).crop
			var result := StationSystem.harvest_crop_batch(franchise.crops[crop_index], state.simulationTimeMs, limit, state.level)
			franchise.crops[crop_index] = result.crop
			runtime.carry = CarrySystem.add_to_carry(runtime.carry, product, result.harvested, result.harvested).container
	if CarrySystem.carry_total(runtime.carry) == 0:
		reset_employee(employee, state.simulationTimeMs)
		return
	var target: Array = barn_point() if crop_index >= 0 or (machine != null and FedAnimal.animal_production(machine.productId, machine.tier) != null) else WarehouseLayout.STOCKROOM_POINT
	if ingredient_trip: target = machine_point(machine.id)
	elif destination != null and destination.kind == "machine":
		runtime.assignedStationId = destination.machineId
		target = machine_point(destination.machineId)
	elif (destination.kind == "retail" if destination != null else shelf_fill(franchise, product) < 1 and product in saleable_products(state, franchise)):
		runtime.assignedStationId = "retail:%s" % product
		target = RetailLayout.retail_service_point(product)
	else: runtime.assignedStationId = "warehouse"
	runtime.state = "NAVIGATE_DROPOFF"
	runtime.stateSince = state.simulationTimeMs
	Paths.set_customer_path(runtime, Paths.navigate_path(pathfinder, [runtime.x, runtime.z], target))

static func employee_dropoff(state: Dictionary, franchise: Dictionary, employee: Dictionary, pathfinder: Callable = Callable()) -> void:
	var runtime: Dictionary = employee.runtime
	var product = CarrySystem.primary_carry_product(runtime.carry)
	if product == null:
		reset_employee(employee, state.simulationTimeMs)
		return
	var quantity := CarrySystem.carry_quantity(runtime.carry, product)
	var machine: Variant = P.find_id(franchise.productionMachines, runtime.assignedStationId) if runtime.assignedStationId != null else null
	if (runtime.assignedStationId != null and runtime.assignedStationId.begins_with("retail:")) or (employee.role == "stocker" and runtime.assignedStationId == "stockroom"):
		var moved: int = mini(quantity, maxi(0, Actions.shelf_capacity(franchise, product) - franchise.shelves[product]))
		franchise.shelves[product] += moved
		runtime.carry = CarrySystem.remove_from_carry(runtime.carry, product, moved).container
		if CarrySystem.carry_total(runtime.carry) > 0:
			route_employee_to_returns(runtime, state.simulationTimeMs, pathfinder)
			return
	elif machine != null and machine.productId != product:
		var temporary := ProductRegistry.create_empty_inventory()
		temporary[product] = quantity
		if machine.productId in store_supply_plan(franchise):
			var result := StationSystem.load_machine(machine, temporary, state.simulationTimeMs)
			for index in franchise.productionMachines.size():
				if franchise.productionMachines[index].id == machine.id:
					franchise.productionMachines[index] = result.machine
					break
			quantity = result.inventory[product]
		if quantity > 0: franchise.warehouse[product] += quantity
	else: franchise.warehouse[product] += quantity
	reset_employee(employee, state.simulationTimeMs)

static func employee_return_carry(state: Dictionary, franchise: Dictionary, employee: Dictionary) -> void:
	var returned := 0
	for product in employee.runtime.carry.items:
		var raw: Variant = employee.runtime.carry.items[product]
		var quantity: int = maxi(0, floori(raw)) if JS.is_finite_number(raw) else 0
		if quantity < 1: continue
		franchise.warehouse[product] += quantity
		returned += quantity
		P.record_domain(state, "employee-return:%s" % product, quantity)
	if returned > 0: P.record_domain(state, "employee-return:warehouse", returned)
	reset_employee(employee, state.simulationTimeMs)

static func cashier_lane_for_employee(franchise: Dictionary, employee: Dictionary) -> Variant:
	var count := CheckoutLayout.open_checkout_lane_count(franchise.unlockedAreas)
	var index := 0
	for worker in franchise.employees:
		if worker.role != "cashier": continue
		if worker.id == employee.id: return index if index < count else null
		index += 1
	return null

static func update_cashier_employee(state: Dictionary, franchise: Dictionary, employee: Dictionary, delta_ms: float, events: Array, pathfinder: Callable = Callable()) -> void:
	var runtime: Dictionary = employee.runtime
	var lane: Variant = cashier_lane_for_employee(franchise, employee)
	if lane == null:
		if runtime.state != "IDLE" or runtime.assignedStationId != null: reset_employee(employee, state.simulationTimeMs)
		return
	var station := "checkout-%d" % (lane + 1)
	var work: Array = [CheckoutLayout.CHECKOUT_LANES[lane].cashierWork[0], CheckoutLayout.CHECKOUT_LANES[lane].cashierWork[2]]
	var transaction: Variant = null
	# Earliest update, retaining source order on ties.
	for candidate in franchise.checkoutTransactions:
		if candidate.state in ["COMPLETE", "ABANDONED"] or JS.get_or(candidate, "checkoutLane", 0) != lane: continue
		if transaction == null or candidate.updatedAt < transaction.updatedAt: transaction = candidate
	if runtime.assignedStationId != station or runtime.state not in ["NAVIGATE_CHECKOUT", "WAIT_CHECKOUT_STATION", "OPERATE_CHECKOUT"]:
		runtime.state = "NAVIGATE_CHECKOUT"
		runtime.assignedStationId = station
		runtime.stateSince = state.simulationTimeMs
		Paths.set_customer_path(runtime, Paths.navigate_path(pathfinder, [runtime.x, runtime.z], work))
		return
	if runtime.state == "NAVIGATE_CHECKOUT":
		if Paths.walk_employee_through_automatic_door(runtime, franchise, delta_ms):
			runtime.x = work[0]
			runtime.z = work[1]
			runtime.targetX = work[0]
			runtime.targetZ = work[1]
			runtime.path = []
			runtime.pathIndex = 0
			runtime.state = "OPERATE_CHECKOUT" if transaction != null else "WAIT_CHECKOUT_STATION"
			runtime.stateSince = state.simulationTimeMs
			runtime.currentSpeed = 0
		return
	if JS.hypot(runtime.x - work[0], runtime.z - work[1]) > 0.16:
		runtime.state = "NAVIGATE_CHECKOUT"
		runtime.assignedStationId = station
		runtime.stateSince = state.simulationTimeMs
		Paths.set_customer_path(runtime, Paths.navigate_path(pathfinder, [runtime.x, runtime.z], work))
		return
	if transaction == null:
		runtime.state = "WAIT_CHECKOUT_STATION"
		runtime.currentSpeed = 0
		return
	runtime.state = "OPERATE_CHECKOUT"
	if state.simulationTimeMs - transaction.lastScannedAt >= Checkout.checkout_scan_interval(franchise, transaction, employee):
		Checkout.process_checkout_unit(state, franchise, transaction, events, employee)
		employee.energy = maxf(0, employee.energy - 0.015)

static func update_employee(state: Dictionary, franchise: Dictionary, employee: Dictionary, delta_ms: float, events: Array, pathfinder: Callable = Callable()) -> void:
	if employee.get("runtime") != null and Paths.is_legacy_farm_service_lane_point([employee.runtime.x, employee.runtime.z]): normalize_persisted_farm_employee(franchise, employee, state.simulationTimeMs)
	var runtime: Dictionary = employee.runtime
	runtime.carry.capacity = EmployeeStats.employee_carry_capacity(employee.level)
	runtime.speed = EmployeeStats.employee_walk_speed(employee.level)
	if employee.role == "cashier":
		if employee.energy > 0: update_cashier_employee(state, franchise, employee, delta_ms, events, pathfinder)
		return
	match runtime.state:
		"IDLE":
			if state.simulationTimeMs - runtime.stateSince < 350 or not assign_employee_task(state, franchise, employee, pathfinder): return
			runtime.state = "NAVIGATE_PICKUP"
			runtime.stateSince = state.simulationTimeMs
		"NAVIGATE_PICKUP":
			if Paths.walk_employee_through_automatic_door(runtime, franchise, delta_ms):
				runtime.state = "PICKUP"
				runtime.stateSince = state.simulationTimeMs
		"PICKUP":
			if state.simulationTimeMs - runtime.stateSince >= 320.0 / EmployeeStats.employee_training_multiplier(employee.level): employee_pickup(state, franchise, employee, pathfinder)
		"NAVIGATE_DROPOFF":
			if employee.role == "stocker":
				var product = CarrySystem.primary_carry_product(runtime.carry)
				if product != null and franchise.shelves[product] >= Actions.shelf_capacity(franchise, product):
					route_employee_to_returns(runtime, state.simulationTimeMs, pathfinder)
					return
			if Paths.walk_employee_through_automatic_door(runtime, franchise, delta_ms):
				runtime.state = "DROPOFF"
				runtime.stateSince = state.simulationTimeMs
		"DROPOFF":
			if state.simulationTimeMs - runtime.stateSince >= 320.0 / EmployeeStats.employee_training_multiplier(employee.level): employee_dropoff(state, franchise, employee, pathfinder)
		"NAVIGATE_RETURN":
			if Paths.walk_employee_through_automatic_door(runtime, franchise, delta_ms):
				runtime.state = "RETURN_TO_WAREHOUSE"
				runtime.stateSince = state.simulationTimeMs
		"RETURN_TO_WAREHOUSE":
			if state.simulationTimeMs - runtime.stateSince >= 320.0 / EmployeeStats.employee_training_multiplier(employee.level): employee_return_carry(state, franchise, employee)

static func normalize_persisted_farm_employee(franchise: Dictionary, employee: Dictionary, now: float) -> void:
	if employee.get("runtime") == null or employee.role == "cashier": return
	var runtime: Dictionary = employee.runtime
	if not runtime.get("path") is Array: runtime.path = []
	var at_retired_home := JS.hypot(runtime.x + 5.3, runtime.z - 3.6) < 0.35
	var assigned_crop: Variant = crop_point(runtime.assignedStationId) if runtime.assignedStationId != null else null
	var assigned_machine: Variant = P.find_id(franchise.productionMachines, runtime.assignedStationId) if runtime.assignedStationId != null else null
	var assigned_machine_point: Variant = machine_point(assigned_machine.id) if assigned_machine != null else null
	var farm_machine: Variant = assigned_machine_point if assigned_machine != null and assigned_machine.id in ["chicken-coop-1", "cow-station-1"] else null
	var current_retired := FarmLayout.is_retired_front_farm_point([runtime.x, runtime.z])
	var retired_route: bool = current_retired or FarmLayout.is_retired_front_farm_point([runtime.targetX, runtime.targetZ]) or runtime.path.any(func(point): return point is Array and point.size() >= 2 and FarmLayout.is_retired_front_farm_point(point))
	var relocate := func(point: Array):
		runtime.x = point[0]
		runtime.z = point[1]
		runtime.targetX = point[0]
		runtime.targetZ = point[1]
		runtime.currentSpeed = 0
	var fallback: Array = assigned_crop if assigned_crop != null else (farm_machine if farm_machine != null else (FarmLayout.FARM_WORKER_HOME if employee.role == "farmer" else [-4.8, -0.9]))
	var relocated_lane := Paths.is_legacy_farm_service_lane_point([runtime.x, runtime.z])
	if relocated_lane:
		relocate.call(fallback)
		runtime.path = []
		runtime.pathIndex = 0
	var relocated_operator: bool = employee.role == "operator" and JS.hypot(runtime.x + 4.8, runtime.z + 1.5) < 0.12
	if relocated_operator: relocate.call([-4.8, -0.9])
	if runtime.state == "IDLE" and CarrySystem.carry_total(runtime.carry) == 0:
		if employee.role == "farmer" and (at_retired_home or current_retired): relocate.call(FarmLayout.FARM_WORKER_HOME)
		elif employee.role == "operator" and current_retired: relocate.call(farm_machine if farm_machine != null else [-4.8, -0.9])
		if at_retired_home or retired_route or relocated_operator or relocated_lane:
			runtime.path = []
			runtime.pathIndex = 0
		return
	var collecting: bool = runtime.state in ["NAVIGATE_PICKUP", "PICKUP"]
	var delivering: bool = runtime.state in ["NAVIGATE_DROPOFF", "DROPOFF"] or (runtime.state == "IDLE" and CarrySystem.carry_total(runtime.carry) > 0 and (retired_route or relocated_lane))
	var ingredient_trip: bool = assigned_machine != null and assigned_machine.productId != runtime.assignedProduct
	var expected: Variant = null
	if collecting:
		if runtime.assignedStationId == "stockroom": expected = WarehouseLayout.STOCKROOM_POINT
		elif assigned_crop != null: expected = assigned_crop
		elif ingredient_trip: expected = barn_point() if FedAnimal.animal_production(assigned_machine.productId, assigned_machine.tier) != null else WarehouseLayout.STOCKROOM_POINT
		else: expected = assigned_machine_point
	elif delivering:
		if runtime.assignedStationId != null and runtime.assignedStationId.begins_with("retail:") and runtime.assignedProduct: expected = RetailLayout.retail_service_point(runtime.assignedProduct)
		elif ingredient_trip: expected = assigned_machine_point
		else: expected = barn_point() if employee.role == "farmer" or assigned_crop != null else WarehouseLayout.STOCKROOM_POINT
	if expected == null:
		if not retired_route: return
		if current_retired: relocate.call(fallback)
		runtime.currentSpeed = 0
		runtime.stateSince = now
		if CarrySystem.carry_total(runtime.carry) > 0:
			runtime.state = "NAVIGATE_DROPOFF"
			Paths.set_customer_path(runtime, Paths.navigate_path(Callable(), [runtime.x, runtime.z], barn_point() if employee.role == "farmer" else WarehouseLayout.STOCKROOM_POINT))
		else:
			runtime.state = "IDLE"
			runtime.assignedProduct = null
			runtime.assignedStationId = null
			runtime.path = []
			runtime.pathIndex = 0
		return
	if current_retired: relocate.call(fallback)
	var endpoint: Variant = runtime.path.back() if not runtime.path.is_empty() else null
	var endpoint_matches: bool = endpoint != null and JS.hypot(endpoint[0] - expected[0], endpoint[1] - expected[1]) < 0.6
	var transition_access: bool = Paths.is_rear_farm_point([runtime.x, runtime.z]) != Paths.is_rear_farm_point(expected) or Paths.is_legacy_farm_service_lane_point([runtime.x, runtime.z])
	var uses_rear: bool = runtime.path.any(func(point): return JS.hypot(point[0] - StorefrontLayout.STORE_REAR_DOOR.x, point[1] - StorefrontLayout.STORE_REAR_DOOR.z) <= 2)
	var delivery_access: bool = delivering and employee.role == "operator" and farm_machine != null
	var wrong_place: bool = runtime.state in ["PICKUP", "DROPOFF"] and JS.hypot(runtime.x - expected[0], runtime.z - expected[1]) >= 0.6
	if not retired_route and not relocated_operator and not relocated_lane and endpoint_matches and (not (transition_access or delivery_access) or uses_rear) and not wrong_place: return
	runtime.state = "NAVIGATE_PICKUP" if collecting else "NAVIGATE_DROPOFF"
	runtime.stateSince = now
	Paths.set_customer_path(runtime, Paths.navigate_path(Callable(), [runtime.x, runtime.z], expected))
