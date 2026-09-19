extends TestCase
## Port of src/game/economy/CampaignPrices.test.ts (case needing MarketEngine,
## SaveAuthority and CheckoutLayout.CHECKOUT_LANES).

## A customer already at the till with one tomato on the belt.
func _add_tomato_checkout(state: Dictionary, id: String) -> void:
	var lane: Dictionary = CheckoutLayout.CHECKOUT_LANES[0]
	state["franchises"][0]["customers"].append({
		"id": id, "identity": 1, "state": "WAIT_CHECKOUT", "shoppingList": [{ "productId": "tomatoes", "requested": 1, "picked": 1 }], "currentLine": 1,
		"basket": { "tomatoes": 1 }, "patienceMs": 10000, "checkoutPatienceMs": 300000, "waitingSince": null, "queueSlot": 0, "transactionId": "%s-tx" % id, "hasCart": true, "hasBag": false, "angry": false,
		"x": lane["customerFront"][0], "z": lane["customerFront"][1], "targetX": lane["customerFront"][0], "targetZ": lane["customerFront"][1], "path": [], "pathIndex": 0, "speed": 1.4, "stateSince": state["simulationTimeMs"], "reservedSocketId": null, "blockedSince": null, "routeFailures": 0, "queueLane": 0,
	})
	state["franchises"][0]["checkoutTransactions"].append({
		"id": "%s-tx" % id, "customerId": id, "pendingItems": [{ "productId": "tomatoes", "quantity": 1, "loaded": 1, "scanned": 0, "bagged": 0 }], "paymentMethod": "card",
		"state": "SCANNING", "nextUnitIndex": 0, "paymentCommitted": false, "updatedAt": state["simulationTimeMs"],
		"lastLoadedAt": state["simulationTimeMs"], "lastScannedAt": state["simulationTimeMs"] - MarketEngine.CHECKOUT_SCAN_UNIT_MS, "lastBaggedAt": state["simulationTimeMs"], "checkoutLane": 0,
	})

func _campaign_at_level(level: int) -> Dictionary:
	var state: Dictionary = MarketEngine.create_campaign_game()
	state["tutorialStep"] = 1
	state["franchises"][0]["purchases"]["purchased"] = JS.map(JS.slice(MartCampaign.OPENING_PURCHASES, 0, level - 1), func(purchase): return purchase["id"])
	var restored: Dictionary = MarketEngine.normalize_game_state(JS.json_clone(state))
	assert_eq(CampaignLevels.campaign_level(restored["franchises"][0]), level)
	restored["franchises"][0]["open"] = true
	restored["franchises"][0]["lastCustomerSpawnAt"] = 999999
	return restored

func _sell_one_tomato(state: Dictionary) -> Dictionary:
	_add_tomato_checkout(state, "sale-%s" % state["level"])
	var current: Dictionary = MarketEngine.apply_game_action(state, { "type": "CHECKOUT", "paymentMethod": "card" })
	assert_true(current["ok"], current["message"])
	var events: Array = current["events"].duplicate()
	var next: Dictionary = current["state"]
	var second := 0
	while second < 6 and not (next["franchises"][0]["checkoutTransactions"].size() > 0 and next["franchises"][0]["checkoutTransactions"][0]["paymentCommitted"]):
		current = MarketEngine.advance_world(next, 1000)
		next = current["state"]
		events.append_array(current["events"])
		second += 1
	var sale = JS.find(events, func(event): return event["category"] == "sales")
	assert_not_null(sale, "sale event")
	assert_eq(SaveAuthority.validate_save_transition(state, next, events), { "ok": true })
	return { "amountMinor": sale["amountMinor"], "till": next["franchises"][0]["registerCashMinor"][0] }

func test_charges_the_level_price_at_the_till_and_the_server_accepts_the_sale() -> void:
	assert_eq(_sell_one_tomato(_campaign_at_level(1)), { "amountMinor": 100, "till": 100 })
	# Level 7: 1,00 € × 1,03⁶ = 1,194 € → 1,19 €.
	assert_eq(_sell_one_tomato(_campaign_at_level(7)), { "amountMinor": 119, "till": 119 })
	assert_eq(_sell_one_tomato(_campaign_at_level(12)), { "amountMinor": JS.round(100 * pow(1.03, 11)), "till": JS.round(100 * pow(1.03, 11)) })
