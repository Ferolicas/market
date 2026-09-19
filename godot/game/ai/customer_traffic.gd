class_name CustomerTraffic
extends RefCounted
## Port of src/game/ai/CustomerTraffic.ts.

static func customer_walk_speed(identity: int) -> float:
	return (1.2 + identity * 0.045) * 1.4

const FINISHING_SHOPPING := [
	"NAVIGATE_TO_QUEUE", "MOVE_QUEUE", "QUEUE_WAIT", "UNLOAD", "WAIT_CHECKOUT", "PAY",
	"NAVIGATE_TO_BAG", "TAKE_BAG", "NAVIGATE_TO_RETURNS", "LEAVE_RETURNS",
	"NAVIGATE_TO_CART_RETURN", "RETURN_CART", "EXIT_STORE", "DESPAWN",
]

## Incoming shoppers reserve their place; checkout/departure opens a new one.
## A bounded overlap prevents an unattended till generating an endless crowd.
static func campaign_needs_customer(customers: Array, target: int) -> bool:
	var live := JS.filter(customers, func(customer): return customer["state"] != "DESPAWN")
	var shopping_or_entering := JS.count(live, func(customer): return not FINISHING_SHOPPING.has(customer["state"]))
	return shopping_or_entering < target and live.size() < mini(30, target * 3)
