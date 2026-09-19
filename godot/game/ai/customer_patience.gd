class_name CustomerPatience
extends RefCounted
## Port of src/game/ai/CustomerPatience.ts.

const CUSTOMER_PATIENCE_MS := 120000
const CUSTOMER_ANGRY_REACTION_MS := 1500

## Shared by simulation and presentation: stop before playing the existing clip.
static func customer_showing_anger(customer: Dictionary, now: float) -> bool:
	return bool(customer["angry"]) and customer["state"] == "NAVIGATE_TO_RETURNS" \
		and now - customer["stateSince"] < CUSTOMER_ANGRY_REACTION_MS
