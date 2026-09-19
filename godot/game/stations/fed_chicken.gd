class_name FedChicken
extends RefCounted
## Port of src/game/stations/FedChicken.ts.
## Compatibility facade for opening-campaign callers; production is shared
## with every animal, not implemented independently for chickens.

## FedChickenState: { tier: 1..5, feed: int, eggs: int, outputCapacity: int, nextEggAtMs: int|null, updatedAtMs: int }

static func create_fed_chicken(now_ms: Variant = 0) -> Variant:
	if not JS.is_safe_integer(now_ms) or now_ms < 0:
		push_error("Invalid simulation time")
		return null
	return { "tier": 1, "feed": 0, "eggs": 0, "outputCapacity": 8, "nextEggAtMs": null, "updatedAtMs": int(now_ms) }

static func chicken_feed_capacity(tier: int) -> int:
	return FedAnimal.animal_production("eggs", tier)["capacity"]

static func chicken_cycle_ms(tier: int) -> int:
	return FedAnimal.animal_production("eggs", tier)["cycleMs"]

static func _domain(state: Dictionary) -> Dictionary:
	return { "feed": state["feed"], "output": state["eggs"], "outputCapacity": state["outputCapacity"], "nextAtMs": state["nextEggAtMs"], "updatedAtMs": state["updatedAtMs"] }

static func _presentation(base: Dictionary, state: Dictionary) -> Dictionary:
	return JS.spread(base, { "feed": state["feed"], "eggs": state["output"], "nextEggAtMs": state["nextAtMs"], "updatedAtMs": state["updatedAtMs"] })

static func advance_fed_chicken(input: Dictionary, now_ms: Variant) -> Dictionary:
	if not JS.is_safe_integer(now_ms) or now_ms < input["updatedAtMs"]: return input
	return _presentation(input, FedAnimal.advance_animal(_domain(input), now_ms, FedAnimal.animal_production("eggs", input["tier"])))

## Returns { state, consumed }.
static func feed_chicken(input: Dictionary, tomatoes: Variant, now_ms: Variant) -> Dictionary:
	var result := FedAnimal.feed_animal(_domain(input), tomatoes, now_ms, FedAnimal.animal_production("eggs", input["tier"]))
	return { "state": _presentation(input, result["state"]), "consumed": result["consumed"] }

## Returns { state, collected }.
static func collect_chicken_eggs(input: Dictionary, capacity: Variant, now_ms: Variant) -> Dictionary:
	var result := FedAnimal.collect_animal(_domain(input), capacity, now_ms, FedAnimal.animal_production("eggs", input["tier"]))
	return { "state": _presentation(input, result["state"]), "collected": result["collected"] }

static func upgrade_fed_chicken(input: Dictionary, now_ms: Variant) -> Dictionary:
	var state := advance_fed_chicken(input, now_ms)
	if state["tier"] == 5 or not JS.is_safe_integer(now_ms) or now_ms < input["updatedAtMs"]: return state
	return JS.spread(state, { "tier": state["tier"] + 1 })
