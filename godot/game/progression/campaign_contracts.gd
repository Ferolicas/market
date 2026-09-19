class_name CampaignContracts
extends RefCounted
## Port of src/game/progression/CampaignContracts.ts.

## ContractDefinition: { id: String, location: String, label: String, products: ProductId[] }
## Original composed orders. Three carried units fit even the initial basket.
## No cash bonuses: these are personal completion requirements, not idle income.
const CAMPAIGN_CONTRACTS := [
	{ "id": "barrio-huerta", "location": "barrio", "label": "Cesta de la huerta", "products": ["tomatoes", "eggs", "corn"] },
	{ "id": "barrio-molienda", "location": "barrio", "label": "Del campo al horno", "products": ["wheat", "flour", "bread"] },
	{ "id": "barrio-despensa", "location": "barrio", "label": "Despensa del vecino", "products": ["milk", "cheese", "coffee"] },
	{ "id": "estacion-desayuno", "location": "estacion", "label": "Desayuno del viajero", "products": ["bread", "coffee", "milk"] },
	{ "id": "estacion-merienda", "location": "estacion", "label": "Merienda para llevar", "products": ["bread", "apples", "juice"] },
	{ "id": "estacion-frescos", "location": "estacion", "label": "Bolsa de frescos", "products": ["eggs", "cheese", "oranges"] },
	{ "id": "marina-frutal", "location": "marina", "label": "Cesta frutal", "products": ["apples", "oranges", "juice"] },
	{ "id": "marina-huerta", "location": "marina", "label": "Huerta costera", "products": ["tomatoes", "corn", "cheese"] },
	{ "id": "marina-familia", "location": "marina", "label": "Desayuno en familia", "products": ["eggs", "milk", "bread"] },
	{ "id": "terminal-salida", "location": "aeropuerto", "label": "Salida temprana", "products": ["coffee", "milk", "bread"] },
	{ "id": "terminal-escala", "location": "aeropuerto", "label": "Tentempié de escala", "products": ["cheese", "apples", "juice"] },
	{ "id": "terminal-destino", "location": "aeropuerto", "label": "Cesta de destino", "products": ["tomatoes", "eggs", "cannedCorn"] },
	{ "id": "campus-estudio", "location": "campus", "label": "Tarde de estudio", "products": ["coffee", "bread", "cheese"] },
	{ "id": "campus-cereales", "location": "campus", "label": "Taller de cereales", "products": ["wheat", "corn", "flour"] },
	{ "id": "campus-lacteos", "location": "campus", "label": "Cesta láctea", "products": ["milk", "cheese", "eggs"] },
	{ "id": "mega-campo", "location": "megastore", "label": "Maestría del campo", "products": ["tomatoes", "wheat", "corn"] },
	{ "id": "mega-produccion", "location": "megastore", "label": "Maestría de producción", "products": ["flour", "cheese", "juice"] },
	{ "id": "mega-comercio", "location": "megastore", "label": "Maestría comercial", "products": ["coffee", "bread", "milk"] },
]
static var CAMPAIGN_CONTRACT_IDS: Array = JS.map(CAMPAIGN_CONTRACTS, func(contract): return contract["id"])

## Returns each contract of the franchise's location with
## { ...contract, completed, unlocked, previousDone, ready }.
static func campaign_contracts(franchise: Dictionary) -> Array:
	var purchases = franchise.get("purchases")
	if purchases == null: return []
	var available_products := MartCampaign.campaign_available_products(purchases)
	var completed: Array = JS.get_or(purchases, "completedContracts", [])
	var definitions := JS.filter(CAMPAIGN_CONTRACTS, func(contract): return contract["location"] == franchise["id"])
	var carry_items: Dictionary = franchise["carry"]["items"]
	var out := []
	for index in definitions.size():
		var contract: Dictionary = definitions[index]
		var unlocked: bool = JS.every(contract["products"], func(product): return available_products.has(product))
		var previous_done: bool = JS.every(JS.slice(definitions, 0, index), func(previous): return completed.has(previous["id"]))
		var is_completed: bool = completed.has(contract["id"])
		out.append(JS.spread(contract, { "completed": is_completed, "unlocked": unlocked, "previousDone": previous_done,
			"ready": not is_completed and unlocked and previous_done and JS.every(contract["products"], func(product): return JS.get_or(carry_items, product, 0) >= 1) }))
	return out
