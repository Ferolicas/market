extends TestCase

## Use the real constructor, validated field-for-field against TypeScript.
const Factory = preload("res://game/core/game_factory.gd")
func _fixture() -> Dictionary:
	var game := Factory.create_initial_game()
	return {"game": game, "franchise": game.franchises[0]}

func test_refreshes_the_feeder_label_when_tomatoes_change_during_an_active_cycle() -> void:
	var franchise: Dictionary = _fixture().franchise
	var base := { "crops": [], "machines": franchise.productionMachines, "nowMs": 0, "unlockedAreas": franchise.unlockedAreas }
	var machines: Array = JS.clone(base.machines)
	JS.find(machines, func(machine): return machine.id == "chicken-coop-1").input.tomatoes = 3
	assert_false(MarketPresentation.same_farm_presentation(base, JS.spread(base, { "machines": machines })))

func test_ignores_world_motion_snapshots_that_cannot_change_a_fixture() -> void:
	var franchise: Dictionary = _fixture().franchise
	var customer := { "id": "customer-1", "state": "NAVIGATE_TO_PRODUCT", "transactionId": null, "currentLine": 0,
		"shoppingList": [{ "productId": "tomatoes", "requested": 2, "picked": 0 }], "x": 1, "z": 1 }
	var moved := JS.spread(customer, { "x": 7, "z": -4, "pathIndex": 3, "patienceMs": 12000 })
	var base := {
		"shelves": franchise.shelves, "shelfTier": 1, "machines": franchise.productionMachines, "customers": [customer],
		"checkoutTransactions": franchise.checkoutTransactions, "returnsBin": franchise.returnsBin,
		"returnedCartCount": franchise.returnedCartCount, "lightsOn": franchise.lightsOn, "dynamicCeilingLights": true,
		"unlockedAreas": franchise.unlockedAreas,
	}
	assert_true(MarketPresentation.same_furniture_presentation(base, JS.spread(base, { "customers": [moved] })))
	assert_false(MarketPresentation.same_furniture_presentation(base, JS.spread(base, { "shelfTier": 2 })))

func test_invalidates_furniture_for_cold_door_and_checkout_unit_transitions() -> void:
	var franchise: Dictionary = _fixture().franchise
	var customer := { "id": "customer-1", "state": "NAVIGATE_TO_PRODUCT", "transactionId": "checkout-1", "currentLine": 0,
		"shoppingList": [{ "productId": "milk", "requested": 1, "picked": 0 }] }
	var transaction := { "id": "checkout-1", "customerId": customer.id, "state": "SCANNING", "checkoutLane": 0, "updatedAt": 10,
		"pendingItems": [{ "productId": "milk", "quantity": 1, "loaded": 1, "scanned": 0, "bagged": 0 }] }
	var base := {
		"shelves": franchise.shelves, "shelfTier": 1, "machines": franchise.productionMachines, "customers": [customer],
		"checkoutTransactions": [transaction], "returnsBin": franchise.returnsBin,
		"returnedCartCount": franchise.returnedCartCount, "lightsOn": franchise.lightsOn, "dynamicCeilingLights": true,
		"unlockedAreas": franchise.unlockedAreas,
	}
	assert_false(MarketPresentation.same_furniture_presentation(base, JS.spread(base, { "customers": [JS.spread(customer, { "state": "PICK_PRODUCT" })] })))
	assert_false(MarketPresentation.same_furniture_presentation(base, JS.spread(base, {
		"checkoutTransactions": [JS.spread(transaction, { "pendingItems": [JS.spread(transaction.pendingItems[0], { "scanned": 1 })] })],
	})))

func test_reconciles_growing_plots_only_when_their_authored_visual_stage_changes() -> void:
	var franchise: Dictionary = _fixture().franchise
	var crop := JS.spread(franchise.crops[0], { "status": "GROWING", "plantedAt": 0, "readyAt": 4000 })
	var base := { "crops": [crop], "machines": franchise.productionMachines, "nowMs": 200, "unlockedAreas": franchise.unlockedAreas }
	assert_eq(MarketPresentation.crop_presentation_stage(crop, 200), 0)
	assert_true(MarketPresentation.same_farm_presentation(base, JS.spread(base, { "nowMs": 900 })))
	assert_eq(MarketPresentation.crop_presentation_stage(crop, 1100), 1)
	assert_false(MarketPresentation.same_farm_presentation(base, JS.spread(base, { "nowMs": 1100 })))
