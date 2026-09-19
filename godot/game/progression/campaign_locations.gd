class_name CampaignLocations
extends RefCounted
## Port of src/game/progression/CampaignLocations.ts.

## LocationProfile: { specialty: String, focus: ProductId[], masteryMultiplier: int, focusMultiplier: int, maximumTypes: int }
## Original balance; all existing chains remain available in every location.
const CAMPAIGN_LOCATIONS := {
	"barrio": { "specialty": "Mercado de proximidad", "focus": ["tomatoes", "eggs"], "masteryMultiplier": 1, "focusMultiplier": 1, "maximumTypes": 3 },
	"estacion": { "specialty": "Desayunos y café", "focus": ["coffee", "bread", "juice"], "masteryMultiplier": 2, "focusMultiplier": 3, "maximumTypes": 3 },
	"marina": { "specialty": "Frutas y zumos", "focus": ["apples", "oranges", "juice"], "masteryMultiplier": 2, "focusMultiplier": 4, "maximumTypes": 3 },
	"aeropuerto": { "specialty": "Cestas variadas para viajeros", "focus": ["coffee", "bread", "cheese", "juice"], "masteryMultiplier": 3, "focusMultiplier": 5, "maximumTypes": 4 },
	"campus": { "specialty": "Lácteos y cereales", "focus": ["milk", "cheese", "corn", "wheat", "flour"], "masteryMultiplier": 3, "focusMultiplier": 6, "maximumTypes": 4 },
	"megastore": { "specialty": "Dominio de todo el surtido", "focus": [], "masteryMultiplier": 8, "focusMultiplier": 8, "maximumTypes": 5 },
}

static func campaign_location(id: Variant) -> Dictionary:
	return JS.get_or(CAMPAIGN_LOCATIONS, id if id is String else "", CAMPAIGN_LOCATIONS["barrio"])

## Level 4 completes the first chicken, so eggs reach the shelf with it.
const CAMPAIGN_EGG_LEVEL := 4
## Hard ceiling shared with the checkout and save budgets.
const CAMPAIGN_MAX_BASKET_UNITS := 15

static func _safe_level(level: Variant) -> int:
	return maxi(1, JS.floor(float(level))) if JS.is_finite_number(level) else 1

## Units one shopper buys: a single tomato before the eggs open, then four
## units spread over every product on sale, plus one more every three levels.
## The random shopper takes exactly one extra unit.
static func campaign_basket_units(level: Variant) -> Dictionary:
	var safe_level := _safe_level(level)
	var base: int = 1 if safe_level < CAMPAIGN_EGG_LEVEL else 4 + (safe_level - CAMPAIGN_EGG_LEVEL) / 3
	return { "base": mini(CAMPAIGN_MAX_BASKET_UNITS - 1, base), "bonus": 1 }

## Shoppers on the floor at once: two until level 4, then one more every five.
static func campaign_customer_limit(level: Variant) -> int:
	var safe_level := _safe_level(level)
	return mini(8, 2 + safe_level / 5)

## Weighted ticket draw shared by both passes of the shopping list.
static func _draw(pool: Array, focus: Array, sample: float) -> int:
	var weights := JS.map(pool, func(product): return 3 if focus.has(product) else 1)
	var ticket: float = sample * JS.sum(weights)
	var index := 0
	while index < weights.size() - 1 and ticket >= weights[index]:
		ticket -= weights[index]
		index += 1
	return index

## Deterministic basket: every product on sale gets at least one unit while the
## budget lasts, and the remainder goes to the location's speciality first, so
## a shopper never walks past a stocked shelf with an empty slot in the list.
static func campaign_shopping_list(location_id: String, available: Array, seed: int, level: Variant) -> Array:
	var rng := [JS.to_uint32(seed)]
	var random := func() -> float:
		rng[0] = JS.lcg_next(rng[0])
		return float(rng[0]) / 4294967296.0
	var profile := campaign_location(location_id)
	var focus: Array = profile["focus"]
	var candidates := JS.unique(available)
	if candidates.is_empty(): return []
	var budget := campaign_basket_units(level)
	# The basket can never exceed what the save schema accepts: five lines of
	# three units, so with few products on sale the budget is trimmed.
	var capacity: int = mini(candidates.size(), CustomerBrain.MAX_SHOPPING_LINES) * CustomerBrain.MAX_SHOPPING_LINE_UNITS
	var total: int = JS.min_of([CAMPAIGN_MAX_BASKET_UNITS, capacity, budget["base"] + (budget["bonus"] if random.call() < 0.5 else 0)])
	var lines := {}
	var pool := candidates.duplicate()
	# One unit each, in weighted order, for as many products as the budget holds.
	while not pool.is_empty() and lines.size() < mini(total, CustomerBrain.MAX_SHOPPING_LINES):
		var index := _draw(pool, focus, random.call())
		lines[pool.pop_at(index)] = 1
	var ordered := lines.keys()
	var remaining: int = total - ordered.size()
	while remaining > 0:
		# Only lines with room left can take another unit.
		var open := JS.filter(ordered, func(product): return JS.get_or(lines, product, 0) < CustomerBrain.MAX_SHOPPING_LINE_UNITS)
		if open.is_empty(): break
		var product = open[_draw(open, focus, random.call())]
		lines[product] = JS.get_or(lines, product, 0) + 1
		remaining -= 1
	return JS.map(ordered, func(product_id): return { "productId": product_id, "requested": lines[product_id], "picked": 0 })
