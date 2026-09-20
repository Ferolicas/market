class_name SceneInteractionZones
extends RefCounted
## Source-authored positions, radii and cadence; availability follows the
## original interactionZoneConfigs in MarketScene.tsx.
static var _all: Array = JSON.parse_string(FileAccess.get_file_as_string("res://assets/authored/ground.json")).zones

static func configs(checkout_level: int, areas: Array, crop_ids: Array, purchase_ids: Array) -> Array:
	var result: Array = []
	for original in _all:
		var id: String = original.id
		if PurchaseLayout.is_purchase_interaction_id(id) and PurchaseLayout.purchase_id_from_interaction(id) not in purchase_ids: continue
		if FarmLayout.is_farm_interaction_id(id):
			if FarmLayout.crop_id_from_farm_interaction(id) not in crop_ids: continue
		var department: Variant = RetailLayout.retail_department_from_stocking_interaction(id)
		if department != null:
			if not FixtureAvailability.fixture_available("fixture:retail-%s-1" % department, areas): continue
			var magnets := RetailLayout.retail_stocking_magnets(department, WorldScale.STORE_LAYOUT_SCALE, WorldScale.STORE_ELEMENT_SCALE, areas)
			if not magnets.any(func(magnet): return is_equal_approx(float(magnet.x), float(original.x)) and is_equal_approx(float(magnet.z), float(original.z))): continue
		if RegisterLayout.is_register_interaction_id(id):
			var lane := RegisterLayout.register_lane(id)
			if lane > 0 and CheckoutLayout.checkout_area_for_lane(lane) not in areas: continue
		if WorkstationLayout.is_workstation_id(id) and not WorkstationLayout.is_workstation_unlocked(id, areas): continue
		var zone: Dictionary = original.duplicate(true)
		if id == "checkout": zone.repeatEveryMs = 340 if checkout_level >= 2 else 450
		result.append(zone)
	return result
