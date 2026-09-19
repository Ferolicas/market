class_name MartCampaign
extends RefCounted
## Port of src/game/progression/MartCampaign.ts.

## Opening purchase graph of the live campaign. Order and prices are the
## owner's authored level list: index + 2 is the level each purchase grants.
const MART_CAMPAIGN_VERSION := 1

## OpeningPurchase: { id: OpeningPurchaseId, label: String, requires: OpeningPurchaseId[],
##   baseCostMinor: int (authored price in Spanish minor units; other countries scale it) }
## Level order authored by the owner: one purchase per level from 2 to 28.
## The dependency graph follows that same spine, so the cheapest available
## purchase is always the next level. Prices are final amounts, not ratios.
const OPENING_PURCHASES := [
	{ "id": "farmer-1", "label": "Primer granjero-reponedor", "requires": [], "baseCostMinor": 2000 },
	{ "id": "egg-display-1", "label": "Estante de huevos", "requires": ["farmer-1"], "baseCostMinor": 2500 },
	{ "id": "chicken-1", "label": "Primera gallina", "requires": ["egg-display-1"], "baseCostMinor": 2000 },
	{ "id": "player-2", "label": "Carga 4 y velocidad +3 %", "requires": ["chicken-1"], "baseCostMinor": 2500 },
	{ "id": "tomato-2", "label": "Segunda planta de tomate", "requires": ["chicken-1"], "baseCostMinor": 5000 },
	{ "id": "farmer-2", "label": "Segundo granjero-reponedor", "requires": ["tomato-2"], "baseCostMinor": 9000 },
	{ "id": "expansion-1", "label": "Ampliación: cereales y segunda granja", "requires": ["farmer-2"], "baseCostMinor": 40000 },
	{ "id": "chicken-1-tier-3", "label": "Gallina: comedero de seis tomates", "requires": ["chicken-1", "expansion-1"], "baseCostMinor": 5000 },
	{ "id": "tomato-3", "label": "Tercera planta de tomate", "requires": ["tomato-2", "expansion-1"], "baseCostMinor": 9000 },
	{ "id": "chicken-1-tier-2", "label": "Gallina: un huevo por segundo", "requires": ["chicken-1-tier-3"], "baseCostMinor": 9000 },
	{ "id": "farmer-3", "label": "Tercer granjero-reponedor", "requires": ["expansion-1"], "baseCostMinor": 12000 },
	{ "id": "wheat-1", "label": "Primer bancal de trigo", "requires": ["expansion-1"], "baseCostMinor": 10000 },
	{ "id": "chicken-2", "label": "Segunda gallina", "requires": ["expansion-1"], "baseCostMinor": 10000 },
	{ "id": "flour-mill-1", "label": "Molino y venta de harina", "requires": ["wheat-1"], "baseCostMinor": 20000 },
	{ "id": "bread-oven-1", "label": "Horno y venta de pan", "requires": ["flour-mill-1"], "baseCostMinor": 50000 },
	{ "id": "dairy-display-1", "label": "Departamento de lácteos", "requires": ["bread-oven-1"], "baseCostMinor": 70000 },
	{ "id": "cow-1", "label": "Primera vaca", "requires": ["dairy-display-1", "wheat-1"], "baseCostMinor": 100000 },
	{ "id": "cow-1-tier-2", "label": "Vaca: producción mejorada", "requires": ["cow-1"], "baseCostMinor": 120000 },
	{ "id": "cow-1-tier-3", "label": "Vaca: comedero ampliado", "requires": ["cow-1-tier-2"], "baseCostMinor": 150000 },
	{ "id": "cheese-maker-1", "label": "Quesería", "requires": ["cow-1"], "baseCostMinor": 160000 },
	{ "id": "apple-1", "label": "Manzano y venta de manzanas", "requires": ["expansion-1"], "baseCostMinor": 30000 },
	{ "id": "corn-1", "label": "Maizal y venta de maíz", "requires": ["wheat-1"], "baseCostMinor": 60000 },
	{ "id": "coffee-supply-1", "label": "Mata de café y góndolas de café", "requires": ["bread-oven-1"], "baseCostMinor": 70000 },
	{ "id": "orange-1", "label": "Naranjo y venta de naranjas", "requires": ["apple-1"], "baseCostMinor": 90000 },
	{ "id": "juice-machine-1", "label": "Exprimidora y venta de zumos", "requires": ["orange-1"], "baseCostMinor": 200000 },
	{ "id": "preserves-supply-1", "label": "Conservas: expositor y suministro", "requires": ["corn-1", "coffee-supply-1"], "baseCostMinor": 120000 },
	{ "id": "corn-canner-1", "label": "Enlatadora de maíz", "requires": ["preserves-supply-1"], "baseCostMinor": 180000 },
]

## Purchase that grants the level reached once it is completed (Map → Dictionary).
static var OPENING_PURCHASE_LEVEL: Dictionary = _build_levels()

static func _build_levels() -> Dictionary:
	var out := {}
	for index in OPENING_PURCHASES.size(): out[OPENING_PURCHASES[index]["id"]] = index + 2
	return out

## Exhaustive by type: adding a catalog product requires an explicit purchase path.
const CAMPAIGN_PRODUCT_REQUIREMENTS := {
	"tomatoes": [], "eggs": ["egg-display-1", "chicken-1"],
	"wheat": ["wheat-1"], "flour": ["flour-mill-1"], "bread": ["bread-oven-1"],
	"apples": ["apple-1"], "corn": ["corn-1"], "coffee": ["coffee-supply-1"],
	"milk": ["dairy-display-1", "cow-1"], "cheese": ["cheese-maker-1"],
	"oranges": ["orange-1"], "juice": ["juice-machine-1"],
	"cannedCorn": ["preserves-supply-1"],
}

static func find_purchase(id: Variant) -> Variant:
	return JS.find(OPENING_PURCHASES, func(purchase): return purchase["id"] == id)

## state: anything with a `purchased` array (OpeningCampaignState or PurchaseState).
static func campaign_available_products(state: Dictionary) -> Array:
	var purchased: Array = JS.get_or(state, "purchased", [])
	return JS.filter(ProductRegistry.PRODUCT_IDS, func(product): return JS.every(CAMPAIGN_PRODUCT_REQUIREMENTS[product], func(purchase): return purchased.has(purchase)))

## OpeningCampaignState: { version: 1, walletMinor, registerMinor, earnedMinor, collectedMinor, investedMinor,
##   contributions: Dictionary<OpeningPurchaseId, int>, purchased: OpeningPurchaseId[] }
static func create_opening_campaign() -> Dictionary:
	return { "version": MART_CAMPAIGN_VERSION, "walletMinor": 0, "registerMinor": 0,
		"earnedMinor": 0, "collectedMinor": 0, "investedMinor": 0,
		"contributions": {}, "purchased": [] }

static func _nonnegative_integer(value: Variant) -> bool:
	return JS.is_safe_integer(value) and value >= 0

static func opening_purchase_cost(id: Variant, country: String) -> Variant:
	var definition = find_purchase(id)
	if definition == null: return null
	var scale: float = float(Catalog.COUNTRIES[country]["startingCapitalMinor"]) / Catalog.COUNTRIES["ES"]["startingCapitalMinor"]
	return JS.round(definition["baseCostMinor"] * scale)

static func opening_purchase_quote(state: Dictionary, id: Variant, country: String) -> Dictionary:
	var definition: Dictionary = find_purchase(id)
	var cost_minor = opening_purchase_cost(id, country)
	var purchased: Array = state["purchased"]
	var completed: bool = purchased.has(id)
	var available: bool = not completed and cost_minor != null and JS.every(definition["requires"], func(required): return purchased.has(required))
	var contributed_minor: int = JS.get_or(state["contributions"], id, 0)
	return JS.spread(definition, { "available": available, "completed": completed, "costMinor": cost_minor, "contributedMinor": contributed_minor,
		"remainingMinor": null if cost_minor == null else maxi(0, cost_minor - contributed_minor) })

## A confirmed checkout credits the till, never the player's wallet.
## Caller must invoke once inside the paymentCommitted domain transition.
static func credit_opening_register(state: Dictionary, amount_minor: Variant) -> Dictionary:
	if not _nonnegative_integer(amount_minor) or amount_minor == 0 \
		or not JS.is_safe_integer(state["earnedMinor"] + amount_minor) \
		or not JS.is_safe_integer(state["registerMinor"] + amount_minor): return state
	return JS.spread(state, { "registerMinor": state["registerMinor"] + int(amount_minor), "earnedMinor": state["earnedMinor"] + int(amount_minor) })

## One proximity pulse transfers real money; animation only presents the delta.
## Pass null as amount to collect the whole register (TS default parameter).
static func collect_opening_register(state: Dictionary, amount_minor: Variant = null) -> Dictionary:
	if amount_minor == null: amount_minor = state["registerMinor"]
	if not _nonnegative_integer(amount_minor): return state
	var moved: int = mini(state["registerMinor"], int(amount_minor))
	if moved == 0 or not JS.is_safe_integer(state["walletMinor"] + moved) \
		or not JS.is_safe_integer(state["collectedMinor"] + moved): return state
	return JS.spread(state, { "registerMinor": state["registerMinor"] - moved,
		"walletMinor": state["walletMinor"] + moved, "collectedMinor": state["collectedMinor"] + moved })

static func fund_opening_purchase(state: Dictionary, id: Variant, country: String, amount_minor: Variant) -> Dictionary:
	var quote := opening_purchase_quote(state, id, country)
	if not quote["available"] or quote["remainingMinor"] == null or not _nonnegative_integer(amount_minor): return state
	var moved: int = JS.min_of([state["walletMinor"], int(amount_minor), quote["remainingMinor"]])
	if moved <= 0: return state
	var total: int = quote["contributedMinor"] + moved
	var purchased: Array = state["purchased"].duplicate()
	if total == quote["costMinor"]: purchased.append(id)
	return JS.spread(state, { "walletMinor": state["walletMinor"] - moved, "investedMinor": state["investedMinor"] + moved,
		"contributions": JS.spread(state["contributions"], { id: total }),
		"purchased": purchased })

static func opening_economy_is_conserved(state: Dictionary) -> bool:
	return JS.every([state["walletMinor"], state["registerMinor"], state["earnedMinor"], state["collectedMinor"], state["investedMinor"]], func(value): return _nonnegative_integer(value)) \
		and state["earnedMinor"] == state["registerMinor"] + state["collectedMinor"] \
		and state["collectedMinor"] == state["walletMinor"] + state["investedMinor"] \
		and state["investedMinor"] == JS.sum_values(state["contributions"])

static func opening_player_stats(state: Dictionary) -> Dictionary:
	var upgraded: bool = state["purchased"].has("player-2")
	return { "capacity": 4 if upgraded else 3, "maximumSpeedRatio": 0.7 * 1.03 if upgraded else 0.7 }

const OPENING_FARMER_STATS := {
	"capacity": 3,
	"maximumPlayerSpeedRatio": 0.7 * 0.7,
	"harvests": true,
	"stocksShelves": true,
	"collectsEggs": true,
	"feedsAnimals": false,
}

## Dependencies, not historical XP, control demand and expansion access.
static func opening_availability(state: Dictionary) -> Dictionary:
	var products := campaign_available_products(state)
	# sort((a, b) => a === "tomatoes" ? -1 : b === "tomatoes" ? 1 : 0): tomatoes first, others keep order.
	var ordered := []
	if products.has("tomatoes"): ordered.append("tomatoes")
	for product in products:
		if product != "tomatoes": ordered.append(product)
	return {
		"customerLimit": 2,
		"products": ordered,
		"tomatoYield": 8,
		"tomatoSaleMinor": 100,
		"eggSaleMinor": 200,
		"expansionAvailable": state["purchased"].has("farmer-1"),
	}
