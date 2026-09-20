class_name LevelOneGuide
extends RefCounted
## Presentation-only port of GameShell.tsx LevelOneGuide.
static func presentation(game: Dictionary, franchise: Dictionary) -> Dictionary:
	var crop: Variant = null
	for candidate in franchise.crops:
		if candidate.productId == "tomatoes" and candidate.status != "LOCKED":
			crop = candidate
			break
	var harvested: float = game.progression.counters.get("harvest:tomatoes", 0)
	var stocked: float = game.progression.counters.get("stock:tomatoes", 0)
	var sales: float = game.progression.counters.get("customers", 0)
	var tomatoes := CarrySystem.carry_quantity(franchise.carry, "tomatoes")
	var growing := 0
	if crop != null and crop.status == "GROWING": growing = int(JS.round(clampf((game.simulationTimeMs - crop.plantedAt) / maxf(1, crop.readyAt - crop.plantedAt), 0, 1) * 100))
	var ready: bool = crop != null and crop.status == "READY"
	var result := {"activeStep": 1, "eyebrow": "PASO 1 DE 5", "title": "Cruza el bancal de tomates" if ready else "Tomates creciendo · %d%%" % growing, "description": "Camina sobre las plantas maduras: los tomates saltarán como un imán hasta la cesta que llevas en las manos." if ready else "La huerta trabaja sola. Recorre la tienda mientras las plantas crecen y vuelve cuando veas frutos maduros.", "progress": maxf(harvested / 3 * 100, growing)}
	if tomatoes > 0 or (harvested >= 3 and stocked < 3):
		result.merge({"activeStep": 2, "eyebrow": "PASO 2 DE 5", "title": "Surte frutas y verduras", "description": "Lleva la cesta al expositor de frutas y verduras. Se colocarán automáticamente por unidad; tienes %d." % tomatoes if tomatoes > 0 else "Vuelve a cruzar el bancal, recoge tomates maduros y llévalos al expositor de frutas y verduras.", "progress": stocked / 3 * 100}, true)
	elif harvested < 3: pass
	elif not franchise.open:
		result.merge({"activeStep": 3, "eyebrow": "PASO 3 DE 5", "title": "Abre el supermercado", "description": "Ya hay tomates reales en el expositor. Pulsa CERRADO en la barra superior para dejar entrar clientes.", "progress": 100}, true)
	elif sales < 1:
		var waiting: bool = franchise.customers.any(func(customer): return customer.state in ["NAVIGATE_TO_QUEUE", "QUEUE_WAIT", "MOVE_QUEUE", "UNLOAD", "WAIT_CHECKOUT", "PAY"])
		result.merge({"activeStep": 5 if waiting else 4, "eyebrow": "PASO %d DE 5" % (5 if waiting else 4), "title": "Atiende la caja" if waiting else "Recibe al primer comprador", "description": "Acércate al puesto de caja. El cliente descargará, tú escanearás y después pagará." if waiting else "El cliente tomará un carro, buscará tomates y formará fila con movimiento continuo.", "progress": 75 if waiting else 35}, true)
	else:
		result.merge({"activeStep": 5, "eyebrow": "NIVEL 1 COMPLETADO", "title": "Tu primera venta está lista", "description": "Has cerrado el ciclo campo → estante → cliente → caja. Recoge el dinero de la caja y entra en un círculo dorado para comprar tu siguiente mejora.", "progress": 100}, true)
	return result
