class_name RetailLayout
extends RefCounted
## Port of src/game/stations/retail-layout.ts.
## Department keys: id, label, color, display [x, y, z], yaw (clockwise
## fixture rotation in degrees, optional), fixtureHalfExtents [hx, hz] (before
## STORE_ELEMENT_SCALE), service [x, z], products (Array of product ids).
## Cross-module: Levels.station_tier_modifiers(tier).capacity and
## FixtureAvailability.fixture_available(id, areas).

## Contact reach: the fixture stocks when the owner touches it, not the aisle.
const RETAIL_STOCKING_MAGNET_REACH = InteractionZone.CONTACT_MAGNET_REACH

const INDIVIDUAL_FLOOR_TILE_LAYOUT = 46.0 / (12 * 3 * 2)
## Two gondolas against the rear wall (where the decorative operations bays
## stood) facing the door; the three that once stood in a row in front of the
## entrance are gone, so the sales floor between the door and the tills is
## open again. The first entry carries the department display and service
## point: the east gondola, whose front apron (x −3.68…−0.9, z ≈ −6.5) is the
## only open ground before the pair, since the bakery display closes the
## west one and the orders block the east.
const PANTRY_DISPLAY_POSITIONS = [
	[-1.9, 0, -7.9],
	[-4, 0, -7.9],
]
const PRODUCE_DISPLAY_POSITIONS = [
	[-4.55, 0, 4.1 - 4 * INDIVIDUAL_FLOOR_TILE_LAYOUT],
	[-7.3, 0, 4.1 - 4 * INDIVIDUAL_FLOOR_TILE_LAYOUT],
]

const RETAIL_DEPARTMENTS = {
	"preserves": { "id": "preserves", "label": "CONSERVAS", "color": "#65833d", "display": [10.1, 0, -4.8], "yaw": 90, "fixtureHalfExtents": [1.2, 0.78], "service": [8.7, -4.8], "products": ["cannedCorn"] },
	# Service points remain useful route destinations, but the actual stocking
	# volume wraps the complete fixture footprint so every walkable side works.
	"bakery": { "id": "bakery", "label": "PAN Y HARINAS", "color": "#b96d39", "display": [-4.3, 0, -5], "yaw": 90, "fixtureHalfExtents": [1.2, 0.78], "service": [-3.05, -5], "products": ["bread", "flour", "wheat"] },
	"pantry": { "id": "pantry", "label": "DESPENSA", "color": "#6f4938", "display": PANTRY_DISPLAY_POSITIONS[0], "yaw": 0, "fixtureHalfExtents": [1.2, 0.78], "service": [-1.9, -6.5], "products": ["coffee"] },
	"eggs": { "id": "eggs", "label": "HUEVOS", "color": "#d49a34", "display": [-10.25, 0, -1.75], "yaw": 0, "fixtureHalfExtents": [1.2, 0.78], "service": [-10.25, -0.4], "products": ["eggs"] },
	"produce": { "id": "produce", "label": "FRUTAS Y VERDURAS", "color": "#3f7b4c", "display": PRODUCE_DISPLAY_POSITIONS[0], "yaw": 0, "fixtureHalfExtents": [1.25, 0.83], "service": [-4.55, 4.1 - 4 * INDIVIDUAL_FLOOR_TILE_LAYOUT - 1.35], "products": ["tomatoes", "apples", "oranges", "corn"] },
	"dairy": { "id": "dairy", "label": "LÁCTEOS", "color": "#4382a1", "display": [-10.34, 0, 0.45 + 3 * INDIVIDUAL_FLOOR_TILE_LAYOUT], "yaw": 90, "fixtureHalfExtents": [1.25, 0.83], "service": [-9.24, 0.45 + 3 * INDIVIDUAL_FLOOR_TILE_LAYOUT], "products": ["milk", "cheese"] },
	# Its north edge (z −2.16) keeps the corridor at x ≈ 3.1 between the sales
	# floor and the back open for the NavMesh.
	"drinks": { "id": "drinks", "label": "BEBIDAS", "color": "#cc6841", "display": [4.35, 0, -3.1], "yaw": 90, "fixtureHalfExtents": [1.18, 0.8], "service": [5.45, -3.1], "products": ["juice"] },
}

const RETAIL_DEPARTMENT_IDS = ["preserves", "bakery", "pantry", "eggs", "produce", "dairy", "drinks"]

## Every visible fixture of a department, in the order units are dealt to them.
static func retail_fixture_display_positions(department_id: String, areas: Array = []) -> Array:
	if department_id == "pantry": return PANTRY_DISPLAY_POSITIONS
	if department_id == "produce":
		return PRODUCE_DISPLAY_POSITIONS if FixtureAvailability.fixture_available("fixture:retail-produce-2", areas) else JS.slice(PRODUCE_DISPLAY_POSITIONS, 0, 1)
	return [RETAIL_DEPARTMENTS[department_id].display]

## Units of one SKU are dealt round-robin across a department's fixtures:
## shelf ordinal `k` lives on fixture `k % count`, so fixture `fixtureIndex`
## shows this many of `total`. Fixture capacity splits the same way.
static func distributed_fixture_quantity(total: float, fixture_index: int, fixture_count: int) -> int:
	return maxi(0, JS.floor((maxf(0.0, total) + fixture_count - 1 - fixture_index) / fixture_count))

## Fixture and fixture-local ordinal of one authoritative shelf ordinal, so a
## stocking flight lands exactly where the rendered unit will appear.
## Returns { fixtureIndex, localOrdinal, localEnd }.
static func retail_stock_fixture_slot(department_id: String, ordinal_input: Variant, shelf_end_input: Variant, areas: Array = []) -> Dictionary:
	var fixture_count := retail_fixture_display_positions(department_id, areas).size()
	var ordinal := maxi(0, JS.floor(float(ordinal_input) if JS.is_finite_number(ordinal_input) else 0.0))
	var shelf_end := maxi(ordinal + 1, JS.floor(float(shelf_end_input) if JS.is_finite_number(shelf_end_input) else float(ordinal + 1)))
	var fixture_index := ordinal % fixture_count
	var local_ordinal := ordinal / fixture_count
	return { "fixtureIndex": fixture_index, "localOrdinal": local_ordinal, "localEnd": maxi(local_ordinal + 1, distributed_fixture_quantity(shelf_end, fixture_index, fixture_count)) }

## Produce table: one tilted bin per SKU, centred on these local x values
## (before STORE_ELEMENT_SCALE) in the order of RETAIL_DEPARTMENTS.produce.products.
const PRODUCE_BIN_PITCH = 0.57
const PRODUCE_BIN_COLUMNS = [-1.5 * PRODUCE_BIN_PITCH, -0.5 * PRODUCE_BIN_PITCH, 0.5 * PRODUCE_BIN_PITCH, 1.5 * PRODUCE_BIN_PITCH]
## Deck shared by every produce bin: centre, forward tilt in radians (the +z
## edge drops towards the camera) and box size, all in local units.
const PRODUCE_DECK = { "center": [0, 0.83, -0.03], "tilt": 0.17, "width": 0.5, "thickness": 0.06, "depth": 1.16 }
## Spacing of unit slots inside one bin; PRODUCE_LAYERS gives the counts.
const PRODUCE_SLOT_GRID = { "columnPitch": 0.15, "rowPitch": 0.19, "unitLift": 0.11, "layerLift": 0.14 }

## Local point on or above a produce deck: `innerY` along the deck normal and
## `innerZ` along its tilted depth, both measured from the deck centre.
static func produce_deck_local_point(x: float, inner_y: float, inner_z: float) -> Array:
	var tilt: float = PRODUCE_DECK.tilt
	return [
		x,
		PRODUCE_DECK.center[1] + cos(tilt) * inner_y - sin(tilt) * inner_z,
		PRODUCE_DECK.center[2] + sin(tilt) * inner_y + cos(tilt) * inner_z,
	]

## Bin centre of one produce SKU; unknown ids fall back to the first bin.
static func produce_bin_column(product_id: String) -> float:
	return PRODUCE_BIN_COLUMNS[maxi(0, RETAIL_DEPARTMENTS.produce.products.find(product_id))]

## Physical shelf levels shared by the fixture renderer and stocking flights.
## Values are local StoreElement coordinates before STORE_ELEMENT_SCALE.
const RETAIL_FIXTURE_LEVELS = {
	"bakery": [0.28, 0.63, 0.98, 1.33, 1.68],
	"pantry": [0.24, 0.6, 0.96, 1.32, 1.68],
	"eggs": [0.22, 0.76, 1.28],
	"dairy": [0.39, 0.66, 0.90, 1.15],
	"drinks": [0.3, 0.7, 1.1, 1.5, 1.9],
}

## Unit grid of one SKU on its fixture. `levels` are shelf heights (local
## StoreElement units), `across` units per level along x, and `depthRows`
## further rows towards the back panel. Units spread over every level before
## the next depth row, so a partly stocked fixture still reads as evenly
## filled and the front row is complete at tier 1.
## Grid keys: levels, across, pitch, originX, frontZ, depthPitch, depthRows, lift.
const RETAIL_SHELF_GRIDS = {
	"cannedCorn": { "levels": RETAIL_FIXTURE_LEVELS.pantry, "across": 8, "pitch": 0.24, "originX": 0, "frontZ": 0.4, "depthPitch": 0.15, "depthRows": 3, "lift": 0.11 },
	"bread": { "levels": [RETAIL_FIXTURE_LEVELS.bakery[0], RETAIL_FIXTURE_LEVELS.bakery[1], RETAIL_FIXTURE_LEVELS.bakery[4]], "across": 8, "pitch": 0.22, "originX": 0, "frontZ": 0.16, "depthPitch": 0.16, "depthRows": 3, "lift": 0.14 },
	"flour": { "levels": [RETAIL_FIXTURE_LEVELS.bakery[2]], "across": 12, "pitch": 0.15, "originX": 0, "frontZ": 0.18, "depthPitch": 0.14, "depthRows": 3, "lift": 0.14 },
	"wheat": { "levels": [RETAIL_FIXTURE_LEVELS.bakery[3]], "across": 12, "pitch": 0.15, "originX": 0, "frontZ": 0.18, "depthPitch": 0.14, "depthRows": 3, "lift": 0.14 },
	"coffee": { "levels": RETAIL_FIXTURE_LEVELS.pantry, "across": 8, "pitch": 0.24, "originX": 0, "frontZ": 0.45, "depthPitch": 0.14, "depthRows": 3, "lift": 0.14 },
	"eggs": { "levels": RETAIL_FIXTURE_LEVELS.eggs, "across": 8, "pitch": 0.17, "originX": 0, "frontZ": 0.26, "depthPitch": 0.15, "depthRows": 3, "lift": 0.075 },
	"milk": { "levels": RETAIL_FIXTURE_LEVELS.dairy, "across": 7, "pitch": 0.135, "originX": -0.55, "frontZ": 0.18, "depthPitch": 0.15, "depthRows": 3, "lift": 0.12 },
	"cheese": { "levels": RETAIL_FIXTURE_LEVELS.dairy, "across": 7, "pitch": 0.135, "originX": 0.55, "frontZ": 0.18, "depthPitch": 0.15, "depthRows": 3, "lift": 0.052 },
	"juice": { "levels": RETAIL_FIXTURE_LEVELS.drinks, "across": 9, "pitch": 0.2, "originX": 0, "frontZ": 0.24, "depthPitch": 0.15, "depthRows": 3, "lift": 0.14 },
}

## Produce layers stacked on one bin deck: units across × rows deep.
const PRODUCE_LAYERS = [[3, 5], [3, 4], [3, 3]]

static func _shelf_grid_front_capacity(grid: Dictionary) -> int:
	return grid.levels.size() * grid.across

## Physical units of one fixture at display tier 1: every level's front row
## (or the complete produce deck). The store capacity of a SKU is this times
## the number of fixtures of its department; higher tiers fill deeper rows.
static var RETAIL_FRONT_CAPACITY: Dictionary = {
	"cannedCorn": _shelf_grid_front_capacity(RETAIL_SHELF_GRIDS.cannedCorn),
	"bread": _shelf_grid_front_capacity(RETAIL_SHELF_GRIDS.bread),
	"flour": _shelf_grid_front_capacity(RETAIL_SHELF_GRIDS.flour),
	"wheat": _shelf_grid_front_capacity(RETAIL_SHELF_GRIDS.wheat),
	"coffee": _shelf_grid_front_capacity(RETAIL_SHELF_GRIDS.coffee),
	"eggs": _shelf_grid_front_capacity(RETAIL_SHELF_GRIDS.eggs),
	# Preserve existing save capacities; the new four-shelf cabinet has 28
	# possible front sockets, of which the original 25 remain available.
	"milk": 25,
	"cheese": 25,
	"juice": _shelf_grid_front_capacity(RETAIL_SHELF_GRIDS.juice),
	"tomatoes": PRODUCE_LAYERS[0][0] * PRODUCE_LAYERS[0][1],
	"apples": PRODUCE_LAYERS[0][0] * PRODUCE_LAYERS[0][1],
	"oranges": PRODUCE_LAYERS[0][0] * PRODUCE_LAYERS[0][1],
	"corn": PRODUCE_LAYERS[0][0] * PRODUCE_LAYERS[0][1],
}

static var PRODUCE_VISUAL_CAPACITY: int = _produce_visual_capacity()

static func _produce_visual_capacity() -> int:
	var total := 0
	for layer in PRODUCE_LAYERS: total += layer[0] * layer[1]
	return total

## Every tier-10 authoritative unit of one fixture still has a visible slot.
static var RETAIL_VISUAL_CAPACITY: Dictionary = {
	"cannedCorn": RETAIL_FRONT_CAPACITY.cannedCorn * RETAIL_SHELF_GRIDS.cannedCorn.depthRows,
	"bread": RETAIL_FRONT_CAPACITY.bread * RETAIL_SHELF_GRIDS.bread.depthRows,
	"flour": RETAIL_FRONT_CAPACITY.flour * RETAIL_SHELF_GRIDS.flour.depthRows,
	"wheat": RETAIL_FRONT_CAPACITY.wheat * RETAIL_SHELF_GRIDS.wheat.depthRows,
	"coffee": RETAIL_FRONT_CAPACITY.coffee * RETAIL_SHELF_GRIDS.coffee.depthRows,
	"eggs": RETAIL_FRONT_CAPACITY.eggs * RETAIL_SHELF_GRIDS.eggs.depthRows,
	"tomatoes": PRODUCE_VISUAL_CAPACITY,
	"apples": PRODUCE_VISUAL_CAPACITY,
	"oranges": PRODUCE_VISUAL_CAPACITY,
	"corn": PRODUCE_VISUAL_CAPACITY,
	"milk": RETAIL_FRONT_CAPACITY.milk * RETAIL_SHELF_GRIDS.milk.depthRows,
	"cheese": RETAIL_FRONT_CAPACITY.cheese * RETAIL_SHELF_GRIDS.cheese.depthRows,
	"juice": RETAIL_FRONT_CAPACITY.juice * RETAIL_SHELF_GRIDS.juice.depthRows,
}

const PRODUCT_RETAIL_DEPARTMENT = {
	"cannedCorn": "preserves",
	"tomatoes": "produce",
	"apples": "produce",
	"oranges": "produce",
	"corn": "produce",
	"eggs": "eggs",
	"milk": "dairy",
	"cheese": "dairy",
	"juice": "drinks",
	"bread": "bakery",
	"flour": "bakery",
	"wheat": "bakery",
	"coffee": "pantry",
}

## Store-wide physical capacity of a SKU at display tier 1.
static func retail_shelf_capacity(product_id: String, areas: Array = []) -> int:
	return RETAIL_FRONT_CAPACITY[product_id] * retail_fixture_display_positions(PRODUCT_RETAIL_DEPARTMENT[product_id], areas).size()

## The one authoritative shelf capacity rule: physical slots at tier 1,
## deeper rows as the display tier grows. Engine, carry planning, objectives
## and presentation all read this.
static func retail_shelf_capacity_for_tier(tier: Variant, product_id: String, areas: Array = []) -> int:
	return maxi(1, JS.round(retail_shelf_capacity(product_id, areas) * Levels.station_tier_modifiers(tier).capacity))

static func retail_service_point(product_id: String) -> Array:
	var service: Array = RETAIL_DEPARTMENTS[PRODUCT_RETAIL_DEPARTMENT[product_id]].service
	return [service[0], service[1]]

static func retail_display_position(department_id: String) -> Array:
	var display: Array = RETAIL_DEPARTMENTS[department_id].display
	return [display[0], display[1], display[2]]

## Complete rounded-rectangle stocking volume in scaled simulation units:
## { fixtureIndex, x, z, halfExtents, enterRadius, exitRadius }
static func retail_stocking_magnet(department_id: String, layout_scale: float, element_scale: float, fixture_index: int = 0) -> Dictionary:
	var department: Dictionary = RETAIL_DEPARTMENTS[department_id]
	var fixtures := retail_fixture_display_positions(department_id)
	var bounded_fixture_index := maxi(0, mini(fixtures.size() - 1, JS.floor(fixture_index)))
	var position: Array = fixtures[bounded_fixture_index] if bounded_fixture_index < fixtures.size() else department.display
	var quarter_turn := absi(JS.get_or(department, "yaw", 0)) % 180 == 90
	return {
		"fixtureIndex": bounded_fixture_index,
		"x": position[0] * layout_scale,
		"z": position[2] * layout_scale,
		"halfExtents": [
			department.fixtureHalfExtents[1 if quarter_turn else 0] * element_scale,
			department.fixtureHalfExtents[0 if quarter_turn else 1] * element_scale,
		],
		"enterRadius": RETAIL_STOCKING_MAGNET_REACH.enter,
		"exitRadius": RETAIL_STOCKING_MAGNET_REACH.exit,
	}

static func retail_stocking_magnets(department_id: String, layout_scale: float, element_scale: float, areas: Array = []) -> Array:
	var magnets := []
	for fixture_index in retail_fixture_display_positions(department_id, areas).size():
		magnets.append(retail_stocking_magnet(department_id, layout_scale, element_scale, fixture_index))
	return magnets

static func _centered_slot(index: int, count: int, spacing: float) -> float:
	return (index - (maxi(1, count) - 1) / 2.0) * spacing

## Exact local destination of one authoritative shelf ordinal. Keep this in
## the station layout layer so a flight and its rendered product cannot drift
## onto different rows as fixtures evolve. Returns [x, y, z].
static func retail_stock_landing_local_position(product_id: String, ordinal_input: Variant, shelf_end_input: Variant) -> Array:
	var visual_capacity: int = RETAIL_VISUAL_CAPACITY[product_id]
	var ordinal := mini(visual_capacity - 1, maxi(0, JS.floor(float(ordinal_input) if JS.is_finite_number(ordinal_input) else 0.0)))
	var shelf_end := mini(visual_capacity, maxi(ordinal + 1, JS.floor(float(shelf_end_input) if JS.is_finite_number(shelf_end_input) else float(ordinal + 1))))

	if PRODUCT_RETAIL_DEPARTMENT[product_id] == "produce":
		# Every SKU owns one bin. Units fill it back to front, three across, and
		# only stack another layer once the deck below is covered.
		var layer := 0
		var layer_start := 0
		while layer < PRODUCE_LAYERS.size() - 1 and ordinal >= layer_start + PRODUCE_LAYERS[layer][0] * PRODUCE_LAYERS[layer][1]:
			layer_start += PRODUCE_LAYERS[layer][0] * PRODUCE_LAYERS[layer][1]
			layer += 1
		var columns: int = PRODUCE_LAYERS[layer][0]
		var rows: int = PRODUCE_LAYERS[layer][1]
		var layer_ordinal := ordinal - layer_start
		var row := mini(rows - 1, layer_ordinal / columns)
		return produce_deck_local_point(
			produce_bin_column(product_id) + (layer_ordinal % columns - (columns - 1) / 2.0) * PRODUCE_SLOT_GRID.columnPitch,
			PRODUCE_SLOT_GRID.unitLift + layer * PRODUCE_SLOT_GRID.layerLift,
			(row - (rows - 1) / 2.0) * PRODUCE_SLOT_GRID.rowPitch,
		)

	var grid: Dictionary = RETAIL_SHELF_GRIDS[product_id]
	var front := _shelf_grid_front_capacity(grid)
	var depth_row := mini(grid.depthRows - 1, ordinal / front)
	var front_ordinal := ordinal - depth_row * front
	var level_count: int = grid.levels.size()
	var level := front_ordinal % level_count
	var column := front_ordinal / level_count
	# Units of this depth row and level that exist below shelfEnd, so a partial
	# row stays centred exactly like the rendered stock.
	var row_end := mini(front, maxi(0, shelf_end - depth_row * front))
	var row_count := mini(grid.across, maxi(column + 1, JS.ceil(float(row_end - level) / level_count)))
	return [
		grid.originX + _centered_slot(column, row_count, grid.pitch),
		grid.levels[level] + grid.lift,
		grid.frontZ - depth_row * grid.depthPitch,
	]

static func stocking_interaction_id(department_id: String) -> String:
	return "stock:" + department_id

## Department id or null.
static func retail_department_from_stocking_interaction(id: String) -> Variant:
	if not id.begins_with("stock:"): return null
	var department_id := id.substr("stock:".length())
	return department_id if RETAIL_DEPARTMENT_IDS.has(department_id) else null

static func is_stocking_interaction_id(id: String) -> bool:
	return retail_department_from_stocking_interaction(id) != null
