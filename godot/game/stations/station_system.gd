class_name StationSystem
extends RefCounted
## Port of src/game/stations/StationSystem.ts.

## CropStatus: "LOCKED" | "EMPTY" | "GROWING" | "READY" | "HARVESTING"
## MachineStatus: "LOCKED" | "IDLE" | "WAITING_INPUT" | "PROCESSING" | "OUTPUT_READY" | "FULL"
## CropStation: { id, productId: CropProductId, status: CropStatus, plantedAt, readyAt, available, tier, baseYield? }
## MachineStation: { id, productId: MachineProductId, status: MachineStatus, input: Partial<Inventory>, output,
##   outputCapacity, startedAt: int|null, completesAt: int|null, tier }

static func crop_growth_duration_ms(product_id: String, tier: Variant = 1, game_level: Variant = 1) -> int:
	var grow_ms: int = Products.config_value(product_id, "growMs", 4000)
	var level_speed: float = 1.0 + minf(0.5, maxi(0, JS.floor(float(game_level)) - 1) * 0.025)
	return maxi(1, JS.round(grow_ms / Levels.station_tier_modifiers(tier)["speed"] / level_speed))

## Units a campaign bed yields per cycle at tier 1, the same for every crop:
## the beds are the same physical planter. Tier steps scale it.
const CAMPAIGN_BED_YIELD := 8

## base_yield null → 3 (TS default parameter).
static func crop_harvest_yield(product_id: String, tier: Variant = 1, base_yield: Variant = null) -> int:
	var base_bed_units: float = float(base_yield) if base_yield != null else 3.0
	var product_yield: int = Products.config_value(product_id, "yield", 1)
	return maxi(1, JS.round(base_bed_units * product_yield * Levels.station_tier_modifiers(tier)["capacity"]))

static func create_crop(id: String, product_id: String, now_ms: Variant, tier: Variant = 1, game_level: Variant = 1, base_yield: Variant = null) -> Dictionary:
	var crop := { "id": id, "productId": product_id, "status": "GROWING", "plantedAt": now_ms, "readyAt": now_ms + crop_growth_duration_ms(product_id, tier, game_level), "available": 0, "tier": tier }
	if base_yield != null: crop["baseYield"] = base_yield
	return crop

static func create_empty_crop(id: String, product_id: String, tier: Variant = 1) -> Dictionary:
	return { "id": id, "productId": product_id, "status": "EMPTY", "plantedAt": 0, "readyAt": 0, "available": 0, "tier": tier }

## Returns { crop, planted }.
static func plant_crop(crop: Dictionary, now_ms: Variant, game_level: Variant = 1) -> Dictionary:
	if crop["status"] != "EMPTY": return { "crop": crop, "planted": false }
	return { "crop": create_crop(crop["id"], crop["productId"], now_ms, crop["tier"], game_level, crop.get("baseYield")), "planted": true }

static func update_crop(crop: Dictionary, now_ms: Variant) -> Dictionary:
	if crop["status"] != "GROWING" or now_ms < crop["readyAt"]: return crop
	return JS.spread(crop, { "status": "READY", "available": crop_harvest_yield(crop["productId"], crop["tier"], crop.get("baseYield")) })

static func crop_progress(crop: Dictionary, now_ms: Variant) -> float:
	if crop["status"] == "READY" or crop["status"] == "HARVESTING": return 1.0
	if crop["status"] != "GROWING": return 0.0
	return clampf(float(now_ms - crop["plantedAt"]) / maxf(1.0, float(crop["readyAt"] - crop["plantedAt"])), 0.0, 1.0)

## Returns { crop, harvested }.
static func harvest_crop(crop_input: Dictionary, now_ms: Variant, game_level: Variant = 1) -> Dictionary:
	var crop := update_crop(crop_input, now_ms)
	if crop["status"] != "READY" or crop["available"] < 1: return { "crop": crop, "harvested": 0 }
	var remaining: int = crop["available"] - 1
	if remaining > 0: return { "crop": JS.spread(crop, { "status": "READY", "available": remaining }), "harvested": 1 }
	return { "crop": create_crop(crop["id"], crop["productId"], now_ms, crop["tier"], game_level, crop.get("baseYield")), "harvested": 1 }

## Composes the authoritative one-unit transition into one capacity-bounded trip.
static func harvest_crop_batch(crop_input: Dictionary, now_ms: Variant, requested: Variant, game_level: Variant = 1) -> Dictionary:
	var ready_crop := update_crop(crop_input, now_ms)
	var safe_requested: int = maxi(0, JS.floor(float(requested))) if JS.is_finite_number(requested) else 0
	var harvest_limit: int = mini(safe_requested, ready_crop["available"]) if ready_crop["status"] == "READY" else 0
	var crop := ready_crop
	var harvested := 0
	for unit in harvest_limit:
		var result := harvest_crop(crop, now_ms, game_level)
		crop = result["crop"]
		harvested += result["harvested"]
		if result["harvested"] < 1: break
	return { "crop": crop, "harvested": harvested }

static func create_machine(id: String, product_id: String, tier: Variant = 1) -> Dictionary:
	return { "id": id, "productId": product_id, "status": "WAITING_INPUT", "input": {}, "output": 0, "outputCapacity": JS.round(Products.config_value(product_id, "outputCapacity", 8) * Levels.station_tier_modifiers(tier)["capacity"]), "startedAt": null, "completesAt": null, "tier": tier }

## Cycle length of a machine at its tier, in simulation ms (may be fractional).
static func machine_cycle_ms(machine: Dictionary) -> Variant:
	return JS.number(Products.config_value(machine["productId"], "cycleMs", 1000) / Levels.station_tier_modifiers(machine["tier"])["speed"])

static func _machine_recipe(machine: Dictionary) -> Array:
	return JS.entries(Products.recipe_of(machine["productId"]))

## Ingredient units a machine's input queue holds: enough recipes to fill its
## whole output buffer, so one loading trip feeds a complete batch (20 wheat
## become 10 flours in a tier-2 mill) and the finished goods are collected
## whenever it suits, never one unit at a time. Animal stations keep their
## own trough capacity.
static func machine_input_capacity(machine: Dictionary, product_id: Variant) -> int:
	var policy = FedAnimal.animal_production(machine["productId"], machine["tier"])
	if policy != null: return policy["capacity"] if product_id == policy["input"] else 0
	var required: int = JS.get_or(Products.recipe_of(machine["productId"]), product_id, 0)
	return required * maxi(1, JS.floor(float(machine["outputCapacity"])))

## Units of an ingredient the queue can still take right now.
static func machine_input_room(machine: Dictionary, product_id: Variant) -> int:
	var policy = FedAnimal.animal_production(machine["productId"], machine["tier"])
	if policy != null: return animal_feed_status(machine)["free"] if product_id == policy["input"] else 0
	return maxi(0, machine_input_capacity(machine, product_id) - JS.get_or(machine["input"], product_id, 0))

## Whole recipes waiting in the queue.
static func machine_queued_cycles(machine: Dictionary) -> int:
	if FedAnimal.animal_production(machine["productId"], machine["tier"]) != null: return 0
	var recipe := _machine_recipe(machine)
	if recipe.is_empty(): return 0
	return JS.min_of(JS.map(recipe, func(entry): return JS.get_or(machine["input"], entry[0], 0) / entry[1]))

## Status derived from the buffers, for a machine that is not mid-cycle.
static func _settle_machine(machine: Dictionary) -> Dictionary:
	if machine["status"] == "LOCKED" or (machine["status"] == "PROCESSING" and machine["completesAt"] != null): return machine
	var status: String
	if machine["output"] >= machine["outputCapacity"]: status = "FULL"
	elif machine["output"] > 0: status = "OUTPUT_READY"
	else: status = "WAITING_INPUT"
	if machine["status"] == status and machine["startedAt"] == null and machine["completesAt"] == null: return machine
	return JS.spread(machine, { "status": status, "startedAt": null, "completesAt": null })

## Takes the next recipe out of the queue when the machine is idle and its
## output buffer has room; otherwise settles the status.
static func _start_machine_cycle(machine: Dictionary, at_ms: Variant) -> Dictionary:
	if machine["status"] == "LOCKED" or (machine["status"] == "PROCESSING" and machine["completesAt"] != null): return machine
	if machine["output"] >= machine["outputCapacity"] or machine_queued_cycles(machine) < 1: return _settle_machine(machine)
	var input: Dictionary = machine["input"].duplicate()
	for entry in _machine_recipe(machine):
		var remaining: int = JS.get_or(input, entry[0], 0) - entry[1]
		if remaining > 0: input[entry[0]] = remaining
		else: input.erase(entry[0])
	return JS.spread(machine, { "input": input, "status": "PROCESSING", "startedAt": at_ms, "completesAt": JS.number(at_ms + machine_cycle_ms(machine)) })

## Puts every ingredient the queue has room for into the machine and starts
## a cycle if it was idle; whatever does not fit stays in the inventory.
## Returns { machine, inventory, loaded }.
static func load_machine(machine: Dictionary, inventory: Dictionary, now_ms: Variant) -> Dictionary:
	var policy = FedAnimal.animal_production(machine["productId"], machine["tier"])
	if policy != null:
		if machine["status"] == "LOCKED": return { "machine": machine, "inventory": inventory, "loaded": false }
		var result := FedAnimal.feed_animal(_animal_state(machine, now_ms), inventory.get(policy["input"]), JS.floor(float(now_ms)), policy)
		var next_inventory: Dictionary = JS.spread(inventory, { policy["input"]: inventory[policy["input"]] - result["consumed"] }) if result["consumed"] else inventory
		return { "machine": _animal_machine(machine, result["state"]), "inventory": next_inventory, "loaded": result["consumed"] > 0 }
	if machine["status"] == "LOCKED": return { "machine": machine, "inventory": inventory, "loaded": false }
	var next_inventory: Dictionary = inventory.duplicate()
	var input: Dictionary = machine["input"].duplicate()
	var loaded := false
	for entry in _machine_recipe(machine):
		var product_id = entry[0]
		var take: int = mini(JS.get_or(next_inventory, product_id, 0), machine_input_room(machine, product_id))
		if take < 1: continue
		next_inventory[product_id] -= take
		input[product_id] = JS.get_or(input, product_id, 0) + take
		loaded = true
	if not loaded: return { "machine": _settle_machine(machine), "inventory": inventory, "loaded": false }
	return { "machine": _start_machine_cycle(JS.spread(machine, { "input": input }), now_ms), "inventory": next_inventory, "loaded": true }

static func update_machine(machine: Dictionary, now_ms: Variant) -> Dictionary:
	var policy = FedAnimal.animal_production(machine["productId"], machine["tier"])
	if policy != null and machine["status"] != "LOCKED": return _animal_machine(machine, FedAnimal.advance_animal(_animal_state(machine, now_ms), JS.floor(float(now_ms)), policy))
	if machine["status"] == "LOCKED": return machine
	var current := machine
	# Every finished cycle delivers its unit and, while the queue holds another
	# recipe and the buffer has room, the next one starts at the exact moment
	# the previous ended: continuous work, bounded by the output capacity.
	while current["status"] == "PROCESSING" and current["completesAt"] != null and now_ms >= current["completesAt"]:
		var produced: int = Products.config_value(current["productId"], "yield", 1)
		var finished_at = current["completesAt"]
		current = _start_machine_cycle(JS.spread(current, { "output": mini(current["outputCapacity"], current["output"] + produced), "status": "WAITING_INPUT", "startedAt": null, "completesAt": null }), finished_at)
	return _settle_machine(current)

## Returns { machine, collected }.
static func collect_machine_output(machine_input: Dictionary, now_ms: Variant) -> Dictionary:
	var policy = FedAnimal.animal_production(machine_input["productId"], machine_input["tier"])
	if policy != null:
		if machine_input["status"] == "LOCKED": return { "machine": machine_input, "collected": 0 }
		var result := FedAnimal.collect_animal(_animal_state(machine_input, now_ms), 1, JS.floor(float(now_ms)), policy)
		return { "machine": _animal_machine(machine_input, result["state"]), "collected": result["collected"] }
	var machine := update_machine(machine_input, now_ms)
	if machine["output"] < 1: return { "machine": machine, "collected": 0 }
	# Freeing a slot in a full buffer lets the queued work resume at once.
	return { "machine": _start_machine_cycle(JS.spread(machine, { "output": machine["output"] - 1 }), now_ms), "collected": 1 }

## Collects one trip without exceeding either available output or free carry space.
static func collect_machine_output_batch(machine_input: Dictionary, now_ms: Variant, requested: Variant) -> Dictionary:
	var safe_requested: int = maxi(0, JS.floor(float(requested))) if JS.is_finite_number(requested) else 0
	var machine := update_machine(machine_input, now_ms)
	var collect_limit: int = mini(safe_requested, machine["output"])
	var collected := 0
	for unit in collect_limit:
		var result := collect_machine_output(machine, now_ms)
		machine = result["machine"]
		collected += result["collected"]
		if result["collected"] < 1: break
	return { "machine": machine, "collected": collected }

## Persist only existing input/output/deadline fields; never replay a consumed input.
static func _animal_state(machine: Dictionary, now_ms: Variant) -> Dictionary:
	var policy: Dictionary = FedAnimal.animal_production(machine["productId"], machine["tier"])
	var started_at = machine["startedAt"]
	return {
		"feed": JS.get_or(machine["input"], policy["input"], 0), "output": machine["output"],
		"outputCapacity": machine["outputCapacity"],
		"nextAtMs": JS.floor(float(machine["completesAt"])) if machine["status"] == "PROCESSING" and machine["completesAt"] != null else null,
		"updatedAtMs": maxi(0, JS.floor(minf(float(now_ms), float(started_at if started_at != null else now_ms)))),
	}

static func _animal_machine(machine: Dictionary, animal: Dictionary) -> Dictionary:
	var policy: Dictionary = FedAnimal.animal_production(machine["productId"], machine["tier"])
	var processing: bool = animal["nextAtMs"] != null
	var status: String
	if processing: status = "PROCESSING"
	elif animal["output"] >= animal["outputCapacity"]: status = "FULL"
	elif animal["output"] > 0: status = "OUTPUT_READY"
	else: status = "WAITING_INPUT"
	return JS.spread(machine, { "input": JS.spread(machine["input"], { policy["input"]: animal["feed"] }), "output": animal["output"],
		"completesAt": animal["nextAtMs"],
		"startedAt": animal["nextAtMs"] - policy["cycleMs"] if processing else null,
		"status": status })

## Returns { capacity, occupied, free }.
static func animal_feed_status(machine: Dictionary) -> Dictionary:
	var policy = FedAnimal.animal_production(machine["productId"], machine["tier"])
	var capacity: int = policy["capacity"] if policy != null else 0
	var input = policy["input"] if policy != null else null
	var occupied: int = (JS.get_or(machine["input"], input, 0) if input != null else 0) + (1 if machine["status"] == "PROCESSING" and machine["completesAt"] != null else 0)
	return { "capacity": capacity, "occupied": occupied, "free": maxi(0, capacity - occupied) }

## Compatibility for the initial chicken fixtures.
static func chicken_feed_status(machine: Dictionary) -> Dictionary:
	return animal_feed_status(machine)
