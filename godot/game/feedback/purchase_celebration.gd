class_name PurchaseCelebration
extends RefCounted
## Port of src/game/feedback/PurchaseCelebration.ts. Snapshot: { franchiseId, purchased: [id, ...] }.

## Loading a store is a baseline, never a purchase made in another store.
## Returns the newly purchased id or null.
static func newly_completed_purchase(previous: Variant, current: Dictionary) -> Variant:
	if previous == null or previous.franchiseId != current.franchiseId: return null
	return JS.find(current.purchased, func(id): return not previous.purchased.has(id))
