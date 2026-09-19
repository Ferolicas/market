class_name FedAnimal
extends RefCounted
## Port of src/game/stations/FedAnimal.ts.

## Original cow balance; chicken values follow the supplied opening document.
const ANIMAL_PRODUCTION := {
	"eggs": { "species": "chicken", "input": "tomatoes", "capacity": [4, 4, 6], "cycleMs": [2000, 1000, 1000] },
	"milk": { "species": "cow", "input": "wheat", "capacity": [6, 6, 8], "cycleMs": [6000, 4000, 3000] },
}

## Policy: { species, input: ProductId, capacity: int, cycleMs: int } or null for non-animal products.
static func animal_production(product: Variant, tier: Variant) -> Variant:
	if product != "eggs" and product != "milk": return null
	var definition: Dictionary = ANIMAL_PRODUCTION[product]
	var multiplier: float = 1.0 + mini(4, maxi(0, JS.floor(float(tier)) - 1)) * 0.25
	return { "species": definition["species"], "input": definition["input"], "capacity": JS.round(definition["capacity"][0] * multiplier), "cycleMs": JS.round(definition["cycleMs"][0] / multiplier) }

## FedAnimalState: { feed: int, output: int, outputCapacity: int, nextAtMs: int|null, updatedAtMs: int }

static func _start(state: Dictionary, now: int, policy: Dictionary) -> void:
	if state["nextAtMs"] != null or state["feed"] < 1 or state["output"] >= state["outputCapacity"]: return
	state["feed"] -= 1
	state["nextAtMs"] = now + policy["cycleMs"]

static func advance_animal(input: Dictionary, now: Variant, policy: Dictionary) -> Dictionary:
	if not JS.is_safe_integer(now) or now < input["updatedAtMs"]: return input
	var state: Dictionary = input.duplicate()
	while state["nextAtMs"] != null and state["nextAtMs"] <= now:
		var completed_at: int = state["nextAtMs"]
		state["output"] += 1
		state["nextAtMs"] = null
		_start(state, completed_at, policy)
	state["updatedAtMs"] = int(now)
	return state

## Returns { state, consumed }.
static func feed_animal(input: Dictionary, quantity: Variant, now: Variant, policy: Dictionary) -> Dictionary:
	var state := advance_animal(input, now, policy)
	if not JS.is_safe_integer(quantity) or quantity <= 0 or not JS.is_safe_integer(now) or now < input["updatedAtMs"]: return { "state": state, "consumed": 0 }
	var consumed: int = mini(int(quantity), maxi(0, policy["capacity"] - state["feed"] - (1 if state["nextAtMs"] != null else 0)))
	if consumed == 0: return { "state": state, "consumed": 0 }
	var next: Dictionary = JS.spread(state, { "feed": state["feed"] + consumed })
	_start(next, int(now), policy)
	return { "state": next, "consumed": consumed }

## Returns { state, collected }.
static func collect_animal(input: Dictionary, capacity: Variant, now: Variant, policy: Dictionary) -> Dictionary:
	var state := advance_animal(input, now, policy)
	if not JS.is_safe_integer(capacity) or capacity <= 0 or not JS.is_safe_integer(now) or now < input["updatedAtMs"]: return { "state": state, "collected": 0 }
	var collected: int = mini(int(capacity), state["output"])
	var next: Dictionary = JS.spread(state, { "output": state["output"] - collected })
	_start(next, int(now), policy)
	return { "state": next, "collected": collected }
