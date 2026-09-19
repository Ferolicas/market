class_name RosterUpgrades
extends RefCounted
## Port of src/game/progression/RosterUpgrades.ts.

## Four upgrade steps per actor, each one twice the price of the previous.
const ROSTER_UPGRADE_STEPS := 4
## Living actors: player, staff and animals. 80 € in Spanish minor units.
const ROSTER_BASE_COST_MINOR := 8000
## Machines cost three times the base of a living actor.
const MACHINE_BASE_COST_MINOR := ROSTER_BASE_COST_MINOR * 3

## RosterEntryKind: "player" | "employee" | "animal" | "machine" | "crop"
## RosterEntry: { id, kind, label, detail, icon, step (upgrades already bought, 0..ROSTER_UPGRADE_STEPS),
##   stepCostsMinor: int[] (price of each of the four steps, already scaled to the country),
##   nextCostMinor: int|null, speed: float, capacity: float }

static func roster_step_cost(kind: String, step: Variant) -> int:
	var base: int = MACHINE_BASE_COST_MINOR if kind == "machine" else ROSTER_BASE_COST_MINOR
	return base * (1 << maxi(0, JS.floor(float(step))))

## Campaign purchases count toward the same four upgrades shown in the roster.
static func roster_base_tier(_franchise: Dictionary, _station_id: String) -> int:
	return 1

static func roster_player_base(_franchise: Dictionary) -> Dictionary:
	return { "speedTier": 1, "capacity": 3 }

static func _clamp_step(value: Variant) -> int:
	return maxi(0, mini(ROSTER_UPGRADE_STEPS, JS.floor(float(value)) if JS.is_finite_number(value) else 0))

static func _entry(id: String, kind: String, label: String, detail: String, icon: String, step: Variant, tier_for_stats: Variant, money_scale: float) -> Dictionary:
	var safe_step := _clamp_step(step)
	var step_costs_minor := []
	for index in ROSTER_UPGRADE_STEPS: step_costs_minor.append(JS.round(roster_step_cost(kind, index) * money_scale))
	var modifiers := Levels.station_tier_modifiers(tier_for_stats)
	return {
		"id": id, "kind": kind, "label": label, "detail": detail, "icon": icon,
		"step": safe_step,
		"stepCostsMinor": step_costs_minor,
		"nextCostMinor": null if safe_step >= ROSTER_UPGRADE_STEPS else step_costs_minor[safe_step],
		"speed": modifiers["speed"],
		"capacity": modifiers["capacity"],
	}

const ANIMAL_LABELS := {
	"chicken-coop-1": { "label": "Primera gallina", "icon": "🐔" },
	"chicken-coop-2": { "label": "Segunda gallina", "icon": "🐔" },
	"cow-station-1": { "label": "Vaca", "icon": "🐄" },
}

const MACHINE_ICONS := {
	"flour-mill-1": "🌀", "bread-oven-1": "🔥", "cheese-maker-1": "🧀",
	"juice-machine-1": "🥤", "corn-canner-1": "🥫",
}

static func _round2(value: float) -> float:
	return JS.round(value * 100) / 100.0

## Everything the owner can train or tune, in one list for the team panel.
static func roster_entries(franchise: Dictionary, money_scale: float) -> Array:
	var player_base := roster_player_base(franchise)
	var player_step := _clamp_step(franchise["playerSpeedTier"] - player_base["speedTier"])
	var entries: Array = [
		_entry("player", "player", "Tú, el fundador",
			"Cesta %s · velocidad T%s" % [franchise["carry"]["capacity"], franchise["playerSpeedTier"]],
			"🧍", player_step, player_base["speedTier"] + player_step, money_scale),
	]
	entries[0]["capacity"] = _round2(float(franchise["carry"]["capacity"]) / 3)
	for employee in franchise["employees"]:
		var detail: String
		if employee["role"] == "cashier":
			detail = "%s · escaneo ×%s" % [employee_role_label(employee["role"]), JS.to_fixed(EmployeeStats.cashier_till_modifiers(employee["level"])["speed"], 2)]
		else:
			detail = "%s · cesta %s" % [employee_role_label(employee["role"]), EmployeeStats.employee_carry_capacity(employee["level"])]
		var card := _entry("employee:%s" % employee["id"], "employee", employee["name"], detail,
			employee_role_icon(employee["role"]), employee["level"] - 1, employee["level"], money_scale)
		# Print the worker's real multipliers, not the station tier table: the
		# cashier's scan and bagging, everyone else's pace and basket.
		if employee["role"] == "cashier":
			card["speed"] = EmployeeStats.cashier_till_modifiers(employee["level"])["speed"]
			card["capacity"] = EmployeeStats.cashier_till_modifiers(employee["level"])["capacity"]
		else:
			card["speed"] = _round2(EmployeeStats.employee_walk_speed(employee["level"]) / EmployeeStats.employee_walk_speed(1))
			card["capacity"] = _round2(float(EmployeeStats.employee_carry_capacity(employee["level"])) / EmployeeStats.employee_carry_capacity(1))
		entries.append(card)
	for machine in franchise["productionMachines"]:
		if machine["status"] == "LOCKED": continue
		var animal = FedAnimal.animal_production(machine["productId"], machine["tier"])
		var base_tier := roster_base_tier(franchise, machine["id"])
		var step := _clamp_step(machine["tier"] - base_tier)
		var product_name: String = Catalog.PRODUCTS[machine["productId"]]["name"]
		if animal != null:
			var naming: Dictionary = JS.get_or(ANIMAL_LABELS, machine["id"], { "label": product_name, "icon": "🐾" })
			entries.append(_entry("station:%s" % machine["id"], "animal", naming["label"],
				"Produce %s · comedero %s" % [product_name.to_lower(), animal["capacity"]],
				naming["icon"], step, machine["tier"], money_scale))
			continue
		var recipe_keys: Array = Products.recipe_of(machine["productId"]).keys()
		var ingredient = recipe_keys[0] if not recipe_keys.is_empty() else null
		var queue: String = " · cola %s %s" % [StationSystem.machine_input_capacity(machine, ingredient), Catalog.PRODUCTS[ingredient]["name"].to_lower()] if ingredient != null else ""
		entries.append(_entry("station:%s" % machine["id"], "machine", _station_label(machine["id"], product_name),
			"Produce %s · almacén %s%s" % [product_name.to_lower(), machine["outputCapacity"], queue],
			JS.get_or(MACHINE_ICONS, machine["id"], "⚙️"), step, machine["tier"], money_scale))
	for crop in franchise["crops"]:
		if crop["status"] == "LOCKED": continue
		# The real per-cycle yield at the current tier, so a bought step shows
		# its effect and a bed without an authored base never reads "undefined".
		entries.append(_entry("station:%s" % crop["id"], "crop", "Bancal de %s" % Catalog.PRODUCTS[crop["productId"]]["name"].to_lower(),
			"Cosecha %s por ciclo" % StationSystem.crop_harvest_yield(crop["productId"], crop["tier"], crop.get("baseYield")), "🌱", crop["tier"] - 1, crop["tier"], money_scale))
	return entries

const _STATION_LABELS := {
	"flour-mill-1": "Molino", "bread-oven-1": "Horno", "cheese-maker-1": "Quesería",
	"juice-machine-1": "Exprimidora", "corn-canner-1": "Enlatadora",
}

static func _station_label(id: String, product_name: String) -> String:
	return JS.get_or(_STATION_LABELS, id, "Estación de %s" % product_name.to_lower())

const _ROLE_LABELS := { "farmer": "Granjero-reponedor", "feeder": "Alimentador", "operator": "Operario", "stocker": "Reponedor", "cashier": "Cajero", "builder": "Constructor", "manager": "Gerente" }
const _ROLE_ICONS := { "farmer": "🌾", "feeder": "🪣", "operator": "⚙️", "stocker": "📦", "cashier": "🧾", "builder": "🔨", "manager": "📋" }

static func employee_role_label(role: String) -> String:
	return _ROLE_LABELS[role]

static func employee_role_icon(role: String) -> String:
	return _ROLE_ICONS[role]
