class_name Levels
extends RefCounted
## Port of src/game/progression/levels.ts.

## LevelDefinition: { level: int, costMinor: int, unlock: String }

## Objective copy and progress live exclusively in objectives.gd. Keeping a
## second copy here previously allowed the level list and the real gate to
## describe different work.
const LEVEL_DATA := [
	[0, "Tomate, mesa y caja"], [4000, "Segundo tomate, manzano y demanda de manzanas"], [8000, "Capacidad 5 y hasta 4 clientes"],
	[14000, "Ampliación y trigo"], [22000, "Molino y harina"], [32000, "Horno y panadería"],
	[48000, "Caja más rápida"], [65000, "Gallinero y huevos"], [85000, "Reponedor"], [110000, "Ampliación lateral y rango 2"],
	[140000, "Maíz y mesa"], [180000, "Velocidad +8 %"], [230000, "Vaca y refrigerador"], [290000, "Cajero"], [370000, "Capacidad 8"],
	[460000, "Quesera"], [580000, "Segunda caja"], [720000, "Almacén y muelle"], [890000, "Hito de proveedores"], [1100000, "Ampliación trasera y rango 3"],
	[1350000, "Máquina de zumo"], [1650000, "Granjero"], [2000000, "Luces y fachada"], [2400000, "Capacidad 12 y estantes T3"], [2900000, "Listas y gestos"],
	[3500000, "Operador"], [4200000, "Tercera zona y endcap"], [5000000, "Fríos, puertas y caja premium"], [6000000, "Último hito operativo"], [7500000, "Rango 4, fachada y franquicia"],
]

static var LEVELS: Array = _build_levels()

static func _build_levels() -> Array:
	var out := []
	for index in LEVEL_DATA.size():
		out.append({ "level": index + 1, "costMinor": LEVEL_DATA[index][0], "unlock": LEVEL_DATA[index][1] })
	return out

static func _safe_floor(value: Variant) -> int:
	return JS.floor(float(value)) if JS.is_finite_number(value) else 0

## project: { costMinor, contributedMinor, completed }
static func build_funding_quote(balance_minor: Variant, project: Dictionary) -> Dictionary:
	var cost_minor: int = maxi(0, _safe_floor(project.get("costMinor")))
	var contributed_minor: int = mini(cost_minor, maxi(0, _safe_floor(project.get("contributedMinor"))))
	var remaining_minor: int = 0 if project.get("completed") else maxi(0, cost_minor - contributed_minor)
	var available_minor: int = maxi(0, _safe_floor(balance_minor))
	return {
		"costMinor": cost_minor,
		"contributedMinor": contributed_minor,
		"remainingMinor": remaining_minor,
		"contributionMinor": mini(available_minor, remaining_minor),
		"completed": bool(project.get("completed")) or remaining_minor == 0,
	}

static func station_tier_modifiers(tier_input: Variant) -> Dictionary:
	var tier: int = maxi(1, mini(5, JS.floor(float(tier_input)) if JS.is_finite_number(tier_input) else 1))
	var multiplier: float = 1.0 + (tier - 1) * 0.25
	return { "capacity": multiplier, "speed": multiplier, "value": 1 }
