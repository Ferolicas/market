class_name CheckoutLayout
extends RefCounted
## Port of src/game/stations/checkout-layout.ts. Lanes are ints 0|1|2;
## points are `[x, z]` Arrays and positions `[x, y, z]` Arrays.

## Every till the store can open, in the order cashiers fill them.
const CHECKOUT_LANE_IDS = [0, 1, 2]

## One source of truth for checkout geometry and navigation.
## Positive Z is the entrance side: cashiers stand there facing into the store,
## while customers approach from the sales floor on the negative-Z side.
## The tills form one column at x 7.55 every 3 units towards the rear. The
## third lane's queue starts further east than the others because the drinks
## display's service point (5.45, −3.1) sits where its queue would otherwise
## begin; slots then run south, between the display and the preserves gondola.
const CHECKOUT_LANES = {
	0: {
		"counter": [7.55, 0, 3.95],
		"cashierWork": [8.05, 0.018, 5.12],
		"customerFront": [7, 2.85],
		"queueStart": [5.35, 2.85],
		"bagPickup": [8.9, 2.85],
	},
	1: {
		"counter": [7.55, 0, 0.95],
		"cashierWork": [8.05, 0.018, 2.12],
		"customerFront": [7, -0.15],
		"queueStart": [5.35, -0.15],
		"bagPickup": [8.9, -0.15],
	},
	2: {
		"counter": [7.55, 0, -2.05],
		"cashierWork": [8.05, 0.018, -0.88],
		"customerFront": [7, -3.15],
		"queueStart": [6.1, -3.95],
		"bagPickup": [8.9, -3.15],
	},
}

static func is_checkout_lane(value: Variant) -> bool:
	if not (value is int or value is float): return false
	return value == 0 or value == 1 or value == 2

## Saved lanes predate the third till or may be missing: fall back to the first.
static func checkout_lane_of(value: Variant) -> int:
	return int(value) if is_checkout_lane(value) else 0

## The area that opens each till; the first one exists from the start.
static func checkout_area_for_lane(lane: int) -> String:
	return "checkout-%d" % (lane + 1)

## Tills open in order, so the count stops at the first closed one.
static func open_checkout_lane_count(areas: Array) -> int:
	var count := 1
	while count < CHECKOUT_LANE_IDS.size() and areas.has(checkout_area_for_lane(count)):
		count += 1
	return count

const CHECKOUT_CAMERA_TARGET = [7.35, 1.25, 3.55]
const CHECKOUT_CAMERA_POSITION = [8.8, 3.2, 6.8]
const CHECKOUT_CAMERA_FRAME = { "width": 10, "height": 10 }

## Cart parks on the customer's right, on the sales-floor side of the belt.
## `customer` needs state, queueLane, queueSlot, x, z. Returns [x, z] or null.
static func checkout_parked_cart(customer: Dictionary) -> Variant:
	var front: Array = CHECKOUT_LANES[checkout_lane_of(customer.get("queueLane"))].customerFront
	var serving: bool = ["UNLOAD", "WAIT_CHECKOUT", "PAY"].has(customer.state)
	var approaching: bool = customer.get("queueSlot") == 0 and ["NAVIGATE_TO_QUEUE", "MOVE_QUEUE"].has(customer.state) \
		and JS.hypot(customer.x - front[0], customer.z - front[1]) < 1.2
	return [front[0] + 1, front[1] - 0.45] if (serving or approaching) else null

const CHECKOUT_QUEUE_SPACING = 0.78
const CHECKOUT_CUSTOMER_FACING_STATES = [
	"QUEUE_WAIT",
	"UNLOAD",
	"WAIT_CHECKOUT",
	"PAY",
]

static func checkout_queue_position(slot: int, lane: int = 0) -> Array:
	var layout: Dictionary = CHECKOUT_LANES[lane]
	if slot <= 0: return [layout.customerFront[0], layout.customerFront[1]]
	return [layout.queueStart[0], layout.queueStart[1] - (slot - 1) * CHECKOUT_QUEUE_SPACING]

## Customers enter every queue slot from directly behind it. Keeping the final
## segment on +Z leaves the body and trolley facing the belt instead of along
## the short end of the checkout. Returns [approach, destination].
static func checkout_queue_arrival(slot: int, lane: int = 0) -> Array:
	var destination := checkout_queue_position(slot, lane)
	return [[destination[0], destination[1] - CHECKOUT_QUEUE_SPACING], destination]

## Stationary customers in a checkout lane must not inherit the yaw of the
## previous NavMesh segment. That segment can disappear from the render
## snapshot on the exact tick in which the FSM enters a waiting state.
##
## The checkout counter remains the single source for the facing target, so a
## lane move cannot leave the body or trolley looking away from its register.
## Returns a float yaw or null.
static func checkout_customer_facing_yaw(customer: Dictionary, position: Array) -> Variant:
	if not CHECKOUT_CUSTOMER_FACING_STATES.has(customer.state): return null
	var counter: Array = CHECKOUT_LANES[checkout_lane_of(customer.get("queueLane"))].counter
	return atan2(counter[0] - position[0], counter[2] - position[1])

## The live (not COMPLETE/ABANDONED) transaction of a lane, or null.
static func active_checkout_for_lane(transactions: Array, lane: int) -> Variant:
	return JS.find(transactions, func(transaction): return JS.get_or(transaction, "checkoutLane", 0) == lane \
		and transaction.state != "COMPLETE" \
		and transaction.state != "ABANDONED")

## A paid bag remains independent from the next transaction using the lane.
## Returns the newest COMPLETE transaction whose customer is fetching it, or null.
static func checkout_handoff_for_lane(transactions: Array, lane: int, customers: Array) -> Variant:
	var handoff_transaction_ids := []
	for customer in customers:
		var transaction_id = customer.get("transactionId")
		if transaction_id and ["NAVIGATE_TO_BAG", "TAKE_BAG"].has(customer.state):
			handoff_transaction_ids.append(transaction_id)
	var fallback: Variant = null
	for transaction in transactions:
		if JS.get_or(transaction, "checkoutLane", 0) != lane or transaction.state != "COMPLETE" or not handoff_transaction_ids.has(transaction.id): continue
		if fallback == null or transaction.updatedAt > fallback.updatedAt: fallback = transaction
	return fallback

## "counter" | "customer" | null
static func checkout_bag_location(transaction: Variant, customers: Array) -> Variant:
	if transaction == null: return null
	var customer = JS.find(customers, func(candidate): return candidate.id == transaction.customerId and candidate.get("transactionId") == transaction.id)
	if transaction.state == "COMPLETE" and customer != null and customer.get("transactionId") == transaction.id and customer.state == "TAKE_BAG":
		return "customer"
	return "counter"
