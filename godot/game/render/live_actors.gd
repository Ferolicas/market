class_name LiveActors
extends RefCounted
## Port of src/game/render/LiveActors.ts.
##
## Latest authoritative actor snapshots, published once per world tick by the
## scene and read inside frame callbacks. Customer and employee bodies use them
## for locomotion and timing, so a tick no longer has to rebuild every body
## just to hand it a new position; a body is rebuilt only when its
## presentation key (state, cart, basket, transaction) actually changes.
## Maps are Dictionaries id → runtime Dictionary.

static var live_actors := {
	"customers": {},
	"transactions": {},
	"employees": {},
	"simulationTimeMs": 0,
}

static func publish_live_actors(customers: Array, transactions: Array, employees: Array, simulation_time_ms: int) -> void:
	var live := live_actors
	if live.simulationTimeMs == simulation_time_ms and live.customers.size() == customers.size() and live.employees.size() == employees.size():
		# Same tick republished by an unrelated render: keep the existing maps so
		# identity checks in frame callbacks stay stable.
		var unchanged := true
		for customer in customers:
			if not is_same(live.customers.get(customer.id), customer):
				unchanged = false
				break
		if unchanged: return
	live.customers.clear()
	for customer in customers: live.customers[customer.id] = customer
	live.transactions.clear()
	for transaction in transactions: live.transactions[transaction.id] = transaction
	live.employees.clear()
	for employee in employees:
		if employee.get("runtime") != null: live.employees[employee.id] = employee.runtime
	live.simulationTimeMs = simulation_time_ms

static func _inventory_key(items: Dictionary) -> String:
	var parts := []
	for product_id in items:
		var quantity = items[product_id]
		if (quantity if quantity != null else 0) > 0: parts.append("%s=%s" % [product_id, quantity])
	return JS.join(parts, ",")

## Fields that change the rendered customer tree or its animation timing.
static func customer_presentation_key(customer: Dictionary, transaction: Variant = null) -> String:
	var basket := _inventory_key(customer.basket)
	var transaction_key := ""
	if transaction != null:
		var lines := JS.map(transaction.pendingItems, func(line): return "%s%s%s%s%s" % [line.productId, line.quantity, line.loaded, line.scanned, line.bagged])
		transaction_key = "%s:%s:%s:%s" % [transaction.id, transaction.state, transaction.updatedAt, JS.join(lines, "|")]
	var shopping_list: Array = customer.shoppingList
	var current_line: int = customer.currentLine
	var current_product: String = shopping_list[current_line].productId if (current_line >= 0 and current_line < shopping_list.size()) else ""
	return JS.join([
		customer.id,
		customer.identity,
		customer.state,
		customer.currentLine,
		current_product,
		1 if customer.hasCart else 0,
		1 if customer.hasBag else 0,
		JS.get_or(customer, "transactionId", ""),
		basket,
		transaction_key,
	], "/")

## Fields that change the rendered employee tree.
static func employee_presentation_key(employee: Dictionary) -> String:
	var runtime = employee.get("runtime")
	var carry := _inventory_key(runtime.carry.items) if runtime != null else ""
	return JS.join([employee.id, employee.role, employee.level, employee.hat, runtime.state if runtime != null else "", carry], "/")
