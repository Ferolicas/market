class_name CustomerBrain
extends RefCounted
## Port of src/game/ai/CustomerBrain.ts.

## CustomerState: see MarketTypes.CUSTOMER_BRAIN_STATES.
## ShoppingLine: { productId: ProductId, requested: int, picked: int }

## Hard bounds of a basket, shared by the shopper generators, the engine and
## the save schema: five products, three units each. A list outside them is
## refused by the server, so nothing may ever create one.
const MAX_SHOPPING_LINES := 5
const MAX_SHOPPING_LINE_UNITS := 3

## CustomerMind: { id, state: CustomerState, shoppingList: ShoppingLine[], currentLine: int, basket: Partial<Inventory>,
##   patienceMs: int, waitingSince: int|null, reservedSocket: String|null, queueSlot: int|null }

## Legacy (pre-campaign) shopper generator. The TS version shuffles with
## `sort(() => random() - 0.5)`, whose exact order depends on V8's sort; here
## a Fisher–Yates shuffle drawn from the same LCG keeps determinism, lengths
## and uniqueness but the shuffled order for a given seed is not identical.
static func create_customer_mind(id: String, unlocked: Array, seed: int, level: int) -> Dictionary:
	var rng := [JS.to_uint32(seed)]
	var random := func() -> float:
		rng[0] = JS.lcg_next(rng[0])
		return float(rng[0]) / 4294967296.0
	var candidates := unlocked.duplicate()
	for index in range(candidates.size() - 1, 0, -1):
		var swap := JS.floor(random.call() * (index + 1))
		var held = candidates[index]
		candidates[index] = candidates[swap]
		candidates[swap] = held
	var maximum_types: int = 5 if level >= 25 else 3
	var type_count: int = mini(candidates.size(), 5 if level >= 25 else 1 + JS.floor(random.call() * maximum_types))
	var shopping_list := JS.map(JS.slice(candidates, 0, type_count), func(product_id): return { "productId": product_id, "requested": 1 + JS.floor(random.call() * 3), "picked": 0 })
	return { "id": id, "state": "SPAWN", "shoppingList": shopping_list, "currentLine": 0, "basket": {}, "patienceMs": CustomerPatience.CUSTOMER_PATIENCE_MS, "waitingSince": null, "reservedSocket": null, "queueSlot": null }

## CustomerSignal: "spawned" | "entered" | "basket-ready" | "list-ready" | "arrived-product" | "socket-reserved" |
##   "product-picked" | "product-empty" | "restocked" | "route-blocked" | "arrived-queue" | "queue-advanced" |
##   "at-checkout" | "unloaded" | "checkout-complete" | "paid" | "bag-received" | "exited"
const CUSTOMER_SIGNALS := ["spawned", "entered", "basket-ready", "list-ready", "arrived-product", "socket-reserved", "product-picked", "product-empty", "restocked", "route-blocked", "arrived-queue", "queue-advanced", "at-checkout", "unloaded", "checkout-complete", "paid", "bag-received", "exited"]

const TRANSITIONS := {
	"SPAWN": { "spawned": "ENTER_STORE" }, "ENTER_STORE": { "entered": "GET_CART" }, "GET_CART": { "basket-ready": "BUILD_SHOPPING_LIST" },
	"BUILD_SHOPPING_LIST": { "list-ready": "NAVIGATE_TO_PRODUCT" }, "NAVIGATE_TO_PRODUCT": { "arrived-product": "WAIT_FOR_ACCESS", "route-blocked": "NAVIGATE_TO_PRODUCT" },
	"WAIT_FOR_ACCESS": { "socket-reserved": "PICK_PRODUCT", "product-empty": "WAIT_RESTOCK" }, "PICK_PRODUCT": { "product-picked": "NEXT_PRODUCT", "product-empty": "WAIT_RESTOCK" },
	"WAIT_RESTOCK": { "restocked": "NAVIGATE_TO_PRODUCT" }, "NEXT_PRODUCT": { "list-ready": "NAVIGATE_TO_PRODUCT", "arrived-queue": "NAVIGATE_TO_QUEUE" },
	"NAVIGATE_TO_QUEUE": { "arrived-queue": "QUEUE_WAIT", "route-blocked": "NAVIGATE_TO_QUEUE" }, "QUEUE_WAIT": { "queue-advanced": "MOVE_QUEUE" },
	"MOVE_QUEUE": { "at-checkout": "UNLOAD", "queue-advanced": "MOVE_QUEUE" }, "UNLOAD": { "unloaded": "WAIT_CHECKOUT" }, "WAIT_CHECKOUT": { "checkout-complete": "PAY" },
	"PAY": { "paid": "NAVIGATE_TO_BAG" }, "NAVIGATE_TO_BAG": { "bag-received": "TAKE_BAG" }, "TAKE_BAG": { "bag-received": "NAVIGATE_TO_CART_RETURN" }, "NAVIGATE_TO_CART_RETURN": { "arrived-queue": "RETURN_CART" }, "RETURN_CART": { "exited": "EXIT_STORE" }, "EXIT_STORE": { "exited": "DESPAWN" },
}

static func transition_customer(mind: Dictionary, signal_name: String, now_ms: int) -> Dictionary:
	var next: Dictionary = JS.clone(mind)
	var target = JS.get_or(TRANSITIONS, next["state"], {}).get(signal_name)
	if target != null: next["state"] = target
	if target == "WAIT_RESTOCK": next["waitingSince"] = now_ms
	if signal_name == "restocked": next["waitingSince"] = null
	return next

## Returns { mind, stock, picked }.
static func commit_picked_product(mind: Dictionary, stock: Dictionary) -> Dictionary:
	var line = mind["shoppingList"][mind["currentLine"]] if mind["currentLine"] < mind["shoppingList"].size() else null
	if line == null or JS.get_or(stock, line["productId"], 0) <= 0 or line["picked"] >= line["requested"]: return { "mind": mind, "stock": stock, "picked": false }
	var next_mind: Dictionary = JS.clone(mind)
	var next_stock: Dictionary = stock.duplicate()
	next_stock[line["productId"]] -= 1
	next_mind["shoppingList"][next_mind["currentLine"]]["picked"] += 1
	next_mind["basket"][line["productId"]] = JS.get_or(next_mind["basket"], line["productId"], 0) + 1
	if next_mind["shoppingList"][next_mind["currentLine"]]["picked"] >= line["requested"]: next_mind["currentLine"] += 1
	return { "mind": next_mind, "stock": next_stock, "picked": true }
