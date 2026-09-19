class_name PaymentCue
extends RefCounted
## Port of src/game/feedback/PaymentCue.ts. Snapshot: { franchiseId, customersToday }.

## Customers who paid in the visited store since the previous snapshot.
## Loading a game, travelling to another store or a new day resetting the
## count are not payments, so they never ring the till.
static func new_customer_payments(previous: Variant, current: Dictionary) -> int:
	if previous == null or previous.franchiseId != current.franchiseId or current.customersToday <= previous.customersToday: return 0
	return current.customersToday - previous.customersToday
