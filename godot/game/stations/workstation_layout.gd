class_name WorkstationLayout
extends RefCounted
## Port of src/game/stations/workstation-layout.ts.
## Workstation keys: id, label, position [x, y, z], facing, unlockArea (optional).

static func _production_station(id: String, label: String, facing: float, unlock_area: String) -> Dictionary:
	var fixture := ProductionLayout.production_fixture_for_workstation(id)
	return { "id": id, "label": label, "position": [fixture.operatorWorkPoint[0], 0, fixture.operatorWorkPoint[1]], "facing": facing, "unlockArea": unlock_area }

static func _animal_station(id: String, label: String, unlock_area: String) -> Dictionary:
	var station: Dictionary = FarmLayout.FARM_ANIMAL_STATIONS[id]
	return { "id": id, "label": label, "position": station.workPosition, "facing": station.facing, "unlockArea": unlock_area }

static func _build_workstations() -> Dictionary:
	var tomato_shelf := RetailLayout.retail_service_point("tomatoes")
	return {
		"canner": _production_station("canner", "Enlatar maíz", PI, "corn-canner"),
		"checkout": { "id": "checkout", "label": "Atender la caja", "position": CheckoutLayout.CHECKOUT_LANES[0].cashierWork, "facing": -2.74 },
		"shelf": { "id": "shelf", "label": "Surtir expositor", "position": [tomato_shelf[0], 0, tomato_shelf[1]], "facing": 0 },
		"mill": _production_station("mill", "Usar molino", PI, "flour-mill"),
		"bakery": _production_station("bakery", "Usar horno", PI, "bread-oven"),
		"cheese": _production_station("cheese", "Usar quesería", 0, "cheese-maker"),
		"juice": _production_station("juice", "Usar máquina de zumos", 0, "juice-machine"),
		"chicken": _animal_station("chicken", "Alimentar o recoger huevos", "chicken-coop"),
		"chicken2": _animal_station("chicken2", "Alimentar o recoger huevos · segunda gallina", "chicken-coop-2"),
		"cow": _animal_station("cow", "Alimentar o recoger leche", "cow-station"),
	}

static var WORKSTATIONS: Dictionary = _build_workstations()

## Only hands-on store jobs live in the world. Farming has one invisible sensor
## per crop bed, while construction and upgrades are managed from the tablet UI
## instead of charging the player from floor buttons.
const WORKSTATION_IDS = ["mill", "bakery", "chicken", "chicken2", "cow", "cheese", "juice", "canner", "shelf", "checkout"]

static func is_workstation_id(id: String) -> bool:
	return WORKSTATION_IDS.has(id)

static func is_workstation_unlocked(id: String, unlocked_areas: Array) -> bool:
	var area = WORKSTATIONS[id].get("unlockArea")
	return area == null or unlocked_areas.has(area)
