class_name Objectives
extends RefCounted
## Port of src/game/progression/objectives.ts.
## Needs RetailLayout.retail_shelf_capacity_for_tier (stations/retail_layout.gd).

## LevelObjectiveTask: { id: String, label: String, progress: float|int, target: float|int, unit: "count"|"percent"|"distance"|"rating" }

static func unlocked_customer_products(level: Variant) -> Array:
	var normalized_level: int = maxi(1, JS.floor(float(level)) if JS.is_finite_number(level) else 1)
	return JS.map(JS.filter(ProductSupply.CUSTOMER_PRODUCT_UNLOCKS, func(entry): return normalized_level >= entry[1]), func(entry): return entry[0])

static func average_shelf_availability(franchise: Dictionary) -> float:
	var unlocked := unlocked_customer_products(maxi(1, int(franchise["storeRank"]) * 10))
	var total := 0.0
	for product_id in unlocked: total += _shelf_fill(franchise, product_id)
	return total / maxi(1, unlocked.size())

static func level_objective_tasks(level: int, state: Dictionary) -> Array:
	var franchise := _current_franchise(state)
	var player_requirement = PLAYER_LEVEL_TASKS.get(level)
	var intentional_action: Array = [_count_task(player_requirement["id"], player_requirement["label"], _counter(state, player_requirement["id"]), player_requirement["target"])] if player_requirement != null else []
	var tasks: Array
	match level:
		1:
			tasks = [
				_count_task("player:harvest:tomatoes", "Cosecha tú 3 tomates", _counter(state, "player:harvest:tomatoes"), 3),
				_count_task("player:stock:tomatoes", "Surte tú 3 tomates", _counter(state, "player:stock:tomatoes"), 3),
				_count_task("player:action:CHECKOUT", "Atiende tú 1 cliente en caja", _counter(state, "player:action:CHECKOUT"), 1),
			]
		2: tasks = [_count_task("customers", "Atiende 2 clientes en total", _counter(state, "customers"), 2)]
		3: tasks = [_count_task("customers", "Atiende 4 clientes en total", _counter(state, "customers"), 4)]
		4: tasks = [_count_task("stock:all", "Surte 12 productos en total", _counter(state, "stock:all"), 12)]
		5: tasks = [_count_task("harvest:wheat", "Cosecha 6 trigos en total", _counter(state, "harvest:wheat"), 6)]
		6: tasks = [_count_task("sales:bread", "Vende 4 panes en total", _counter(state, "sales:bread"), 4)]
		7: tasks = [_count_task("customers", "Atiende 12 clientes en total", _counter(state, "customers"), 12)]
		8: tasks = [_count_task("sales:eggs", "Vende 8 huevos en total", _counter(state, "sales:eggs"), 8)]
		9: tasks = [{ "id": "shelves:availability", "label": "Mantén los estantes al 80 %", "progress": average_shelf_availability(franchise), "target": 0.8, "unit": "percent" }]
		10: tasks = [_count_task("sales:units", "Vende 20 productos en total", _counter(state, "sales:units"), 20)]
		11: tasks = [_count_task("harvest:corn", "Cosecha 20 maíces en total", _counter(state, "harvest:corn"), 20)]
		12: tasks = [{ "id": "distance:player", "label": "Camina 500 m", "progress": _counter(state, "distance:player"), "target": 500, "unit": "distance" }]
		13: tasks = [_count_task("sales:milk", "Vende 12 leches en total", _counter(state, "sales:milk"), 12)]
		14: tasks = [_count_task("customers", "Atiende 30 clientes en total", _counter(state, "customers"), 30)]
		15: tasks = [_count_task("transport:all", "Transporta 40 productos en total", _counter(state, "transport:all"), 40)]
		16: tasks = [_count_task("production:cheese", "Produce 10 quesos en total", _counter(state, "production:cheese"), 10)]
		17: tasks = [_count_task("queue:under30", "Completa 1 venta con espera menor a 30 s", _counter(state, "queue:under30"), 1)]
		18: tasks = [_count_task("deliveries", "Recibe 5 entregas en total", _counter(state, "deliveries"), 5)]
		19: tasks = [_count_task("orders", "Realiza 8 pedidos en total", _counter(state, "orders"), 8)]
		20: tasks = [_count_task("customers", "Atiende 50 clientes en total", _counter(state, "customers"), 50)]
		21: tasks = [_count_task("sales:juice", "Vende 15 zumos en total", _counter(state, "sales:juice"), 15)]
		22: tasks = [_count_task("harvest:all", "Cosecha 60 productos en total", _counter(state, "harvest:all"), 60)]
		23: tasks = [{ "id": "store:rating", "label": "Alcanza 4,25 de valoración", "progress": franchise["rating"], "target": 4.25, "unit": "rating" }]
		24: tasks = [_count_task("stock:all", "Surte 100 productos en total", _counter(state, "stock:all"), 100)]
		25: tasks = [_count_task("lists:five", "Completa 1 compra con 5 tipos de producto", _counter(state, "lists:five"), 1)]
		26: tasks = [_count_task("production:all", "Produce 50 lotes en total", _counter(state, "production:all"), 50)]
		27: tasks = [_count_task("sales:units", "Vende 150 productos en total", _counter(state, "sales:units"), 150)]
		28:
			var station_tiers: Array = franchise["stationTiers"].values()
			tasks = [_count_task("stations:tier-3", "Mejora todas las estaciones al nivel 3", JS.count(station_tiers, func(tier): return tier >= 3), station_tiers.size())]
		29: tasks = [_count_task("availability:sales", "Completa 50 ventas con estantes al 90 %", _counter(state, "availability:sales"), 50)]
		30: tasks = [_count_task("level:max", "Nivel máximo alcanzado", 1, 1)]
		_: tasks = []
	return tasks if level == 1 else tasks + intentional_action

static func level_objective_satisfied(level: Variant, state: Dictionary) -> bool:
	if not JS.is_integer(level) or level < 1 or level > 30: return false
	return JS.every(level_objective_tasks(int(level), state), func(task): return task["progress"] >= task["target"])

static func _count_task(id: String, label: String, progress: Variant, target: Variant) -> Dictionary:
	return { "id": id, "label": label, "progress": progress, "target": target, "unit": "count" }

static func _counter(state: Dictionary, id: String) -> int:
	return maxi(0, JS.get_or(state["progression"]["counters"], id, 0) - JS.get_or(state["progression"]["levelStartedCounters"], id, 0))

const PLAYER_LEVEL_TASKS := {
	2: { "id": "player:harvest:apples", "label": "Cosecha tú 2 manzanas", "target": 2 },
	3: { "id": "player:stock:all", "label": "Surte tú 5 productos", "target": 5 },
	4: { "id": "player:pickup:warehouse", "label": "Recoge tú 3 productos del almacén", "target": 3 },
	5: { "id": "player:harvest:wheat", "label": "Cosecha tú 3 trigos", "target": 3 },
	6: { "id": "player:machine:bread-oven-1", "label": "Opera tú el horno de pan", "target": 2 },
	7: { "id": "player:action:CHECKOUT", "label": "Escanea tú en caja 2 veces", "target": 2 },
	8: { "id": "player:pickup:eggs", "label": "Transporta tú 4 huevos", "target": 4 },
	9: { "id": "player:stock:all", "label": "Corrige tú 8 huecos de estante", "target": 8 },
	10: { "id": "player:action:CHECKOUT", "label": "Interviene tú 4 veces en caja", "target": 4 },
	11: { "id": "player:harvest:corn", "label": "Cosecha tú 8 maíces", "target": 8 },
	12: { "id": "player:stock:all", "label": "Repón tú 10 productos durante el recorrido", "target": 10 },
	13: { "id": "player:pickup:milk", "label": "Transporta tú 6 leches", "target": 6 },
	14: { "id": "player:action:CHECKOUT", "label": "Atiende tú 5 pulsos de caja", "target": 5 },
	15: { "id": "player:transport:all", "label": "Transporta tú 12 productos", "target": 12 },
	16: { "id": "player:machine:cheese-maker-1", "label": "Opera tú la quesera", "target": 2 },
	17: { "id": "player:action:CHECKOUT", "label": "Refuerza tú las cajas 5 veces", "target": 5 },
	18: { "id": "player:orders", "label": "Haz tú 2 pedidos de abastecimiento", "target": 2 },
	19: { "id": "player:orders", "label": "Planifica tú 4 pedidos", "target": 4 },
	20: { "id": "player:action:CHECKOUT", "label": "Interviene tú 8 veces en hora punta", "target": 8 },
	21: { "id": "player:machine:juice-machine-1", "label": "Opera tú la máquina de zumo", "target": 2 },
	22: { "id": "player:harvest:all", "label": "Cosecha tú 20 productos", "target": 20 },
	23: { "id": "player:stock:all", "label": "Repón tú 15 productos para recuperar servicio", "target": 15 },
	24: { "id": "player:pickup:warehouse", "label": "Mueve tú 20 productos desde almacén", "target": 20 },
	25: { "id": "player:action:CHECKOUT", "label": "Atiende tú 8 pulsos de una hora variada", "target": 8 },
	26: { "id": "player:action:OPERATE_MACHINE", "label": "Opera tú maquinaria 6 veces", "target": 6 },
	27: { "id": "player:stock:all", "label": "Repón tú 30 productos en la nueva zona", "target": 30 },
	28: { "id": "player:action:CONTRIBUTE_UPGRADE", "label": "Aporta tú a 4 mejoras operativas", "target": 4 },
	29: { "id": "player:action:CHECKOUT", "label": "Supera tú 12 pulsos del desafío final", "target": 12 },
}

static func _current_franchise(state: Dictionary) -> Dictionary:
	var found = JS.find(state["franchises"], func(item): return item["id"] == state["currentFranchiseId"])
	return found if found != null else state["franchises"][0]

static func _shelf_fill(franchise: Dictionary, product_id: String) -> float:
	return float(franchise["shelves"][product_id]) / _shelf_capacity(franchise, product_id)

static func _shelf_capacity(franchise: Dictionary, product_id: String) -> float:
	return float(RetailLayout.retail_shelf_capacity_for_tier(JS.get_or(franchise["stationTiers"], "shelves-1", franchise["shelvesLevel"]), product_id, franchise["unlockedAreas"]))
