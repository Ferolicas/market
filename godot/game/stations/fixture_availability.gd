class_name FixtureAvailability
extends RefCounted
## Port of src/game/stations/fixture-availability.ts.

const REQUIRED_AREAS := {
	"fixture:flour-mill": "flour-mill", "fixture:bread-oven": "bread-oven",
	"fixture:cheese-maker": "cheese-maker", "fixture:juice-machine": "juice-machine",
	"fixture:checkout-2": "checkout-2", "fixture:checkout-3": "checkout-3", "fixture:chicken-coop": "chicken-coop",
	"fixture:chicken-coop-2": "chicken-coop-2", "fixture:cow-station": "cow-station",
}

## Every area a finished campaign has opened: the store with all its
## furniture, for layout rules that must hold in the fullest shop.
static var ALL_PURCHASED_AREAS: Array = ["purchase-campaign"] + REQUIRED_AREAS.values() + \
	["expansion-side", "coffee-supply", "farm-wheat", "egg-display", "dairy-display", "preserves-supply", "corn-canner"]

## One rule for rendering, physics and navigation. Legacy scenes stay unchanged.
static func fixture_available(id: Variant, areas: Array = []) -> bool:
	if id == "fixture:corn-canner": return areas.has("corn-canner")
	if id is String and id.begins_with("fixture:retail-preserves-"): return areas.has("preserves-supply")
	if not areas.has("purchase-campaign") or id == null or id == "": return true
	if id == "fixture:retail-produce-2": return areas.has("expansion-side")
	if id.begins_with("fixture:production-cubicle-"): return areas.has("flour-mill")
	if id.begins_with("fixture:retail-pantry-"): return areas.has("coffee-supply")
	if id.begins_with("fixture:retail-bakery-"): return areas.has("farm-wheat")
	if id.begins_with("fixture:retail-eggs-"): return areas.has("egg-display")
	if id.begins_with("fixture:retail-dairy-"): return areas.has("dairy-display")
	if id.begins_with("fixture:retail-drinks-"): return areas.has("juice-machine")
	return not REQUIRED_AREAS.has(id) or areas.has(REQUIRED_AREAS[id])
