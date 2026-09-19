class_name RegisterLayout
extends RefCounted
## Port of src/game/stations/register-layout.ts.

const REGISTER_INTERACTION_IDS = ["register-0", "register-1", "register-2"]

static func is_register_interaction_id(id: String) -> bool:
	return REGISTER_INTERACTION_IDS.has(id)

static func register_lane(id: String) -> int:
	return 2 if id == "register-2" else (1 if id == "register-1" else 0)

## Beside the cashier mat, not on the cashier's reserved workstation. [x, y, z]
static func register_pickup_position(lane: int) -> Array:
	var cashier_work: Array = CheckoutLayout.CHECKOUT_LANES[lane].cashierWork
	return [cashier_work[0] - 1.25, 0.06, cashier_work[2]]
