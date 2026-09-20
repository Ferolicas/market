class_name CustomerAnimationPresentation
extends RefCounted
## Exact state/queue-phase selection from components/game/Customer.tsx.
static func select(customer: Dictionary, simulation_time_ms: float, elapsed: float = 0, checkout_loading: bool = false, runs_free: bool = false) -> String:
	if CustomerPatience.customer_showing_anger(customer, simulation_time_ms): return "Impatient"
	match customer.state:
		"ENTER_STORE": return "Run" if runs_free else "Enter"
		"GET_CART", "BUILD_SHOPPING_LIST": return "CarryBasket"
		"NAVIGATE_TO_PRODUCT", "NAVIGATE_TO_QUEUE", "MOVE_QUEUE", "NAVIGATE_TO_BAG", "NAVIGATE_TO_RETURNS", "NAVIGATE_TO_CART_RETURN": return "BasketWalk"
		"WAIT_FOR_ACCESS": return "Browse"
		"PICK_PRODUCT": return "ReachShelf"
		"QUEUE_WAIT":
			var phase := fmod(elapsed + customer.identity * 2.31, 18)
			if phase < 8: return "Queue"
			if phase < 11: return "Wait"
			if phase < 13: return "Phone"
			if phase < 15.5: return "Queue"
			if phase < 17: return "Impatient"
			return "Talk"
		"UNLOAD", "LEAVE_RETURNS", "RETURN_CART": return "CheckoutItem"
		"WAIT_CHECKOUT": return "CheckoutItem" if checkout_loading else ("Confused" if int(customer.identity) % 3 == 0 else ("Wait" if int(customer.identity) % 2 != 0 else "Queue"))
		"PAY": return "Pay"
		"TAKE_BAG": return "ReceiveBag"
		"EXIT_STORE": return "Run" if runs_free else "Exit"
		"WAIT_RESTOCK": return "Confused"
	return "Idle"
