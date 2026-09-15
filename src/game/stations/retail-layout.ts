import type { ProductId } from "../types";
import { stationTierModifiers } from "../progression/levels";

export type RetailDepartmentId = "bakery" | "pantry" | "eggs" | "produce" | "dairy" | "drinks";
export type StockingInteractionId = `stock:${RetailDepartmentId}`;

export interface RetailDepartment {
  id: RetailDepartmentId;
  label: string;
  color: string;
  display: readonly [number, number, number];
  /** Clockwise fixture rotation in degrees around its own vertical axis. */
  yaw?: number;
  /** Half extents of the visible fixture before STORE_ELEMENT_SCALE. */
  fixtureHalfExtents: readonly [number, number];
  service: readonly [number, number];
  products: readonly ProductId[];
}

/** Reach measured outwards from every physical edge of a retail fixture. */
export const RETAIL_STOCKING_MAGNET_REACH = { enter: 1.1, exit: 1.3 } as const;

const INDIVIDUAL_FLOOR_TILE_LAYOUT = 46 / (12 * 3 * 2);
/** Three gondolas side by side facing the entrance, set half again as deep
 * into the floor as before (z 2.5 → 0.25, so the front face stands 6.8
 * layout units from the door instead of 4.6), then two more against the
 * rear wall (where the decorative operations bays stood) facing the door.
 * The first entry carries the department magnet and service point. The row
 * seals the aisle west of it against the first produce table, so every
 * north–south walk uses the corridor east of x 2.46; the drinks display sits
 * far enough south (z ≤ −2.16) for Recast to keep that corridor open. */
export const PANTRY_DISPLAY_POSITIONS = [
  [-0.5, 0, 0.25],
  [-2.5, 0, 0.25],
  [1.5, 0, 0.25],
  [-4, 0, -7.9],
  [-1.9, 0, -7.9],
] as const;
export const PRODUCE_DISPLAY_POSITIONS = [
  [-4.55, 0, 4.1 - 4 * INDIVIDUAL_FLOOR_TILE_LAYOUT],
  [-7.3, 0, 4.1 - 4 * INDIVIDUAL_FLOOR_TILE_LAYOUT],
] as const;

export const RETAIL_DEPARTMENTS: Record<RetailDepartmentId, RetailDepartment> = {
  // Service points remain useful route destinations, but the actual stocking
  // volume wraps the complete fixture footprint so every walkable side works.
  bakery: { id: "bakery", label: "PAN Y HARINAS", color: "#b96d39", display: [-4.3, 0, -5], yaw: 90, fixtureHalfExtents: [1.2, 0.78], service: [-3.05, -5], products: ["bread", "flour", "wheat"] },
  pantry: { id: "pantry", label: "DESPENSA", color: "#6f4938", display: [...PANTRY_DISPLAY_POSITIONS[0]], yaw: 0, fixtureHalfExtents: [1.2, 0.78], service: [-0.5, 1.65], products: ["coffee"] },
  eggs: { id: "eggs", label: "HUEVOS", color: "#d49a34", display: [-10.25, 0, -1.75], yaw: 0, fixtureHalfExtents: [1.2, 0.78], service: [-10.25, -0.4], products: ["eggs"] },
  produce: { id: "produce", label: "FRUTAS Y VERDURAS", color: "#3f7b4c", display: [...PRODUCE_DISPLAY_POSITIONS[0]], yaw: 0, fixtureHalfExtents: [1.25, 0.83], service: [-4.55, 4.1 - 4 * INDIVIDUAL_FLOOR_TILE_LAYOUT - 1.35], products: ["tomatoes", "apples", "oranges", "corn"] },
  dairy: { id: "dairy", label: "LÁCTEOS", color: "#4382a1", display: [-10.34, 0, 0.45 + 3 * INDIVIDUAL_FLOOR_TILE_LAYOUT], yaw: 90, fixtureHalfExtents: [1.25, 0.83], service: [-9.24, 0.45 + 3 * INDIVIDUAL_FLOOR_TILE_LAYOUT], products: ["milk", "cheese"] },
  // Moved 2.2 south with the entrance row: its north edge (z −2.16) must stay
  // about two layout units diagonally from the row's south-east corner or the
  // NavMesh loses the only corridor between the sales floor and the back.
  drinks: { id: "drinks", label: "BEBIDAS", color: "#cc6841", display: [4.35, 0, -3.1], yaw: 90, fixtureHalfExtents: [1.18, 0.8], service: [5.45, -3.1], products: ["juice"] },
};

export const RETAIL_DEPARTMENT_IDS = Object.keys(RETAIL_DEPARTMENTS) as RetailDepartmentId[];

/** Every visible fixture of a department, in the order units are dealt to them. */
export function retailFixtureDisplayPositions(departmentId: RetailDepartmentId): readonly (readonly [number, number, number])[] {
  if (departmentId === "pantry") return PANTRY_DISPLAY_POSITIONS;
  if (departmentId === "produce") return PRODUCE_DISPLAY_POSITIONS;
  return [RETAIL_DEPARTMENTS[departmentId].display];
}

/** Units of one SKU are dealt round-robin across a department's fixtures:
 * shelf ordinal `k` lives on fixture `k % count`, so fixture `fixtureIndex`
 * shows this many of `total`. Fixture capacity splits the same way. */
export function distributedFixtureQuantity(total: number, fixtureIndex: number, fixtureCount: number) {
  return Math.max(0, Math.floor((Math.max(0, total) + fixtureCount - 1 - fixtureIndex) / fixtureCount));
}

/** Fixture and fixture-local ordinal of one authoritative shelf ordinal, so a
 * stocking flight lands exactly where the rendered unit will appear. */
export function retailStockFixtureSlot(departmentId: RetailDepartmentId, ordinalInput: number, shelfEndInput: number) {
  const fixtureCount = retailFixtureDisplayPositions(departmentId).length;
  const ordinal = Math.max(0, Math.floor(Number.isFinite(ordinalInput) ? ordinalInput : 0));
  const shelfEnd = Math.max(ordinal + 1, Math.floor(Number.isFinite(shelfEndInput) ? shelfEndInput : ordinal + 1));
  const fixtureIndex = ordinal % fixtureCount;
  const localOrdinal = Math.floor(ordinal / fixtureCount);
  return { fixtureIndex, localOrdinal, localEnd: Math.max(localOrdinal + 1, distributedFixtureQuantity(shelfEnd, fixtureIndex, fixtureCount)) };
}

/** Produce table: one tilted bin per SKU, centred on these local x values
 * (before STORE_ELEMENT_SCALE) in the order of RETAIL_DEPARTMENTS.produce.products. */
export const PRODUCE_BIN_PITCH = 0.57;
export const PRODUCE_BIN_COLUMNS: readonly number[] = [-1.5, -0.5, 0.5, 1.5].map((slot) => slot * PRODUCE_BIN_PITCH);
/** Deck shared by every produce bin: centre, forward tilt in radians (the +z
 * edge drops towards the camera) and box size, all in local units. */
export const PRODUCE_DECK = { center: [0, 0.83, -0.03], tilt: 0.17, width: 0.5, thickness: 0.06, depth: 1.16 } as const;
/** Spacing of unit slots inside one bin; PRODUCE_LAYERS gives the counts. */
export const PRODUCE_SLOT_GRID = { columnPitch: 0.15, rowPitch: 0.19, unitLift: 0.11, layerLift: 0.14 } as const;

/** Local point on or above a produce deck: `innerY` along the deck normal and
 * `innerZ` along its tilted depth, both measured from the deck centre. */
export function produceDeckLocalPoint(x: number, innerY: number, innerZ: number): [number, number, number] {
  const tilt = PRODUCE_DECK.tilt;
  return [
    x,
    PRODUCE_DECK.center[1] + Math.cos(tilt) * innerY - Math.sin(tilt) * innerZ,
    PRODUCE_DECK.center[2] + Math.sin(tilt) * innerY + Math.cos(tilt) * innerZ,
  ];
}

/** Bin centre of one produce SKU; unknown ids fall back to the first bin. */
export function produceBinColumn(productId: ProductId): number {
  return PRODUCE_BIN_COLUMNS[Math.max(0, RETAIL_DEPARTMENTS.produce.products.indexOf(productId))];
}

/** Physical shelf levels shared by the fixture renderer and stocking flights.
 * Values are local StoreElement coordinates before STORE_ELEMENT_SCALE. */
export const RETAIL_FIXTURE_LEVELS = {
  bakery: [0.28, 0.63, 0.98, 1.33, 1.68],
  pantry: [0.24, 0.6, 0.96, 1.32, 1.68],
  eggs: [0.28, 0.68, 1.08, 1.48],
  dairy: [0.32, 0.72, 1.12, 1.52, 1.92],
  drinks: [0.3, 0.7, 1.1, 1.5, 1.9],
} as const;

/** Unit grid of one SKU on its fixture. `levels` are shelf heights (local
 * StoreElement units), `across` units per level along x, and `depthRows`
 * further rows towards the back panel. Units spread over every level before
 * the next depth row, so a partly stocked fixture still reads as evenly
 * filled and the front row is complete at tier 1. */
export interface RetailShelfGrid {
  levels: readonly number[];
  across: number;
  pitch: number;
  originX: number;
  frontZ: number;
  depthPitch: number;
  depthRows: number;
  lift: number;
}

export const RETAIL_SHELF_GRIDS: Record<Exclude<ProductId, "tomatoes" | "apples" | "oranges" | "corn">, RetailShelfGrid> = {
  bread: { levels: [RETAIL_FIXTURE_LEVELS.bakery[0], RETAIL_FIXTURE_LEVELS.bakery[1], RETAIL_FIXTURE_LEVELS.bakery[4]], across: 8, pitch: 0.22, originX: 0, frontZ: 0.16, depthPitch: 0.16, depthRows: 3, lift: 0.14 },
  flour: { levels: [RETAIL_FIXTURE_LEVELS.bakery[2]], across: 12, pitch: 0.15, originX: 0, frontZ: 0.18, depthPitch: 0.14, depthRows: 3, lift: 0.14 },
  wheat: { levels: [RETAIL_FIXTURE_LEVELS.bakery[3]], across: 12, pitch: 0.15, originX: 0, frontZ: 0.18, depthPitch: 0.14, depthRows: 3, lift: 0.14 },
  coffee: { levels: RETAIL_FIXTURE_LEVELS.pantry, across: 8, pitch: 0.24, originX: 0, frontZ: 0.45, depthPitch: 0.14, depthRows: 3, lift: 0.14 },
  eggs: { levels: RETAIL_FIXTURE_LEVELS.eggs, across: 6, pitch: 0.19, originX: 0, frontZ: 0.31, depthPitch: 0.13, depthRows: 3, lift: 0.205 },
  milk: { levels: RETAIL_FIXTURE_LEVELS.dairy, across: 5, pitch: 0.17, originX: -0.55, frontZ: 0.24, depthPitch: 0.15, depthRows: 3, lift: 0.14 },
  cheese: { levels: RETAIL_FIXTURE_LEVELS.dairy, across: 5, pitch: 0.17, originX: 0.55, frontZ: 0.24, depthPitch: 0.15, depthRows: 3, lift: 0.14 },
  juice: { levels: RETAIL_FIXTURE_LEVELS.drinks, across: 9, pitch: 0.2, originX: 0, frontZ: 0.24, depthPitch: 0.15, depthRows: 3, lift: 0.14 },
};

/** Produce layers stacked on one bin deck: units across × rows deep. */
export const PRODUCE_LAYERS = [[3, 5], [3, 4], [3, 3]] as const;

function shelfGridFrontCapacity(grid: RetailShelfGrid) {
  return grid.levels.length * grid.across;
}

/** Physical units of one fixture at display tier 1: every level's front row
 * (or the complete produce deck). The store capacity of a SKU is this times
 * the number of fixtures of its department; higher tiers fill deeper rows. */
export const RETAIL_FRONT_CAPACITY: Record<ProductId, number> = {
  bread: shelfGridFrontCapacity(RETAIL_SHELF_GRIDS.bread),
  flour: shelfGridFrontCapacity(RETAIL_SHELF_GRIDS.flour),
  wheat: shelfGridFrontCapacity(RETAIL_SHELF_GRIDS.wheat),
  coffee: shelfGridFrontCapacity(RETAIL_SHELF_GRIDS.coffee),
  eggs: shelfGridFrontCapacity(RETAIL_SHELF_GRIDS.eggs),
  milk: shelfGridFrontCapacity(RETAIL_SHELF_GRIDS.milk),
  cheese: shelfGridFrontCapacity(RETAIL_SHELF_GRIDS.cheese),
  juice: shelfGridFrontCapacity(RETAIL_SHELF_GRIDS.juice),
  tomatoes: PRODUCE_LAYERS[0][0] * PRODUCE_LAYERS[0][1],
  apples: PRODUCE_LAYERS[0][0] * PRODUCE_LAYERS[0][1],
  oranges: PRODUCE_LAYERS[0][0] * PRODUCE_LAYERS[0][1],
  corn: PRODUCE_LAYERS[0][0] * PRODUCE_LAYERS[0][1],
};

const PRODUCE_VISUAL_CAPACITY = PRODUCE_LAYERS.reduce((sum, [across, rows]) => sum + across * rows, 0);

/** Every tier-10 authoritative unit of one fixture still has a visible slot. */
export const RETAIL_VISUAL_CAPACITY: Record<ProductId, number> = {
  bread: RETAIL_FRONT_CAPACITY.bread * RETAIL_SHELF_GRIDS.bread.depthRows,
  flour: RETAIL_FRONT_CAPACITY.flour * RETAIL_SHELF_GRIDS.flour.depthRows,
  wheat: RETAIL_FRONT_CAPACITY.wheat * RETAIL_SHELF_GRIDS.wheat.depthRows,
  coffee: RETAIL_FRONT_CAPACITY.coffee * RETAIL_SHELF_GRIDS.coffee.depthRows,
  eggs: RETAIL_FRONT_CAPACITY.eggs * RETAIL_SHELF_GRIDS.eggs.depthRows,
  tomatoes: PRODUCE_VISUAL_CAPACITY,
  apples: PRODUCE_VISUAL_CAPACITY,
  oranges: PRODUCE_VISUAL_CAPACITY,
  corn: PRODUCE_VISUAL_CAPACITY,
  milk: RETAIL_FRONT_CAPACITY.milk * RETAIL_SHELF_GRIDS.milk.depthRows,
  cheese: RETAIL_FRONT_CAPACITY.cheese * RETAIL_SHELF_GRIDS.cheese.depthRows,
  juice: RETAIL_FRONT_CAPACITY.juice * RETAIL_SHELF_GRIDS.juice.depthRows,
};

export const PRODUCT_RETAIL_DEPARTMENT: Record<ProductId, RetailDepartmentId> = {
  tomatoes: "produce",
  apples: "produce",
  oranges: "produce",
  corn: "produce",
  eggs: "eggs",
  milk: "dairy",
  cheese: "dairy",
  juice: "drinks",
  bread: "bakery",
  flour: "bakery",
  wheat: "bakery",
  coffee: "pantry",
};

/** Store-wide physical capacity of a SKU at display tier 1. */
export function retailShelfCapacity(productId: ProductId) {
  return RETAIL_FRONT_CAPACITY[productId] * retailFixtureDisplayPositions(PRODUCT_RETAIL_DEPARTMENT[productId]).length;
}

/** The one authoritative shelf capacity rule: physical slots at tier 1,
 * deeper rows as the display tier grows. Engine, carry planning, objectives
 * and presentation all read this. */
export function retailShelfCapacityForTier(tier: number, productId: ProductId) {
  return Math.max(1, Math.round(retailShelfCapacity(productId) * stationTierModifiers(tier).capacity));
}

export function retailServicePoint(productId: ProductId): [number, number] {
  return [...RETAIL_DEPARTMENTS[PRODUCT_RETAIL_DEPARTMENT[productId]].service];
}

/**
 * Footprint of the three entrance gondolas in layout units, enlarged by a
 * walking margin, for the pre-Recast fallback router: a horizontal leg whose
 * z lies inside this band would cross the row.
 */
export function pantryEntranceRowBand(elementToLayout: number, margin: number) {
  const row = PANTRY_DISPLAY_POSITIONS.slice(0, 3);
  const halfX = RETAIL_DEPARTMENTS.pantry.fixtureHalfExtents[0] * elementToLayout;
  const halfZ = RETAIL_DEPARTMENTS.pantry.fixtureHalfExtents[1] * elementToLayout;
  return {
    minX: Math.min(...row.map((position) => position[0])) - halfX - margin,
    maxX: Math.max(...row.map((position) => position[0])) + halfX + margin,
    minZ: row[0][2] - halfZ - margin,
    maxZ: row[0][2] + halfZ + margin,
  };
}

export function retailDisplayPosition(departmentId: RetailDepartmentId): [number, number, number] {
  return [...RETAIL_DEPARTMENTS[departmentId].display];
}

/** Complete rounded-rectangle stocking volume in scaled simulation units. */
export function retailStockingMagnet(
  departmentId: RetailDepartmentId,
  layoutScale: number,
  elementScale: number,
  fixtureIndex = 0,
) {
  const department = RETAIL_DEPARTMENTS[departmentId];
  const fixtures = retailFixtureDisplayPositions(departmentId);
  const boundedFixtureIndex = Math.max(0, Math.min(fixtures.length - 1, Math.floor(fixtureIndex)));
  const position = fixtures[boundedFixtureIndex] ?? department.display;
  const quarterTurn = Math.abs(department.yaw ?? 0) % 180 === 90;
  return {
    fixtureIndex: boundedFixtureIndex,
    x: position[0] * layoutScale,
    z: position[2] * layoutScale,
    halfExtents: [
      department.fixtureHalfExtents[quarterTurn ? 1 : 0] * elementScale,
      department.fixtureHalfExtents[quarterTurn ? 0 : 1] * elementScale,
    ] as const,
    enterRadius: RETAIL_STOCKING_MAGNET_REACH.enter * elementScale,
    exitRadius: RETAIL_STOCKING_MAGNET_REACH.exit * elementScale,
  };
}

export function retailStockingMagnets(departmentId: RetailDepartmentId, layoutScale: number, elementScale: number) {
  return retailFixtureDisplayPositions(departmentId).map((_, fixtureIndex) => retailStockingMagnet(departmentId, layoutScale, elementScale, fixtureIndex));
}

function centeredSlot(index: number, count: number, spacing: number) {
  return (index - (Math.max(1, count) - 1) / 2) * spacing;
}

/** Exact local destination of one authoritative shelf ordinal. Keep this in
 * the station layout layer so a flight and its rendered product cannot drift
 * onto different rows as fixtures evolve. */
export function retailStockLandingLocalPosition(productId: ProductId, ordinalInput: number, shelfEndInput: number): [number, number, number] {
  const visualCapacity = RETAIL_VISUAL_CAPACITY[productId];
  const ordinal = Math.min(visualCapacity - 1, Math.max(0, Math.floor(Number.isFinite(ordinalInput) ? ordinalInput : 0)));
  const shelfEnd = Math.min(visualCapacity, Math.max(ordinal + 1, Math.floor(Number.isFinite(shelfEndInput) ? shelfEndInput : ordinal + 1)));

  if (PRODUCT_RETAIL_DEPARTMENT[productId] === "produce") {
    // Every SKU owns one bin. Units fill it back to front, three across, and
    // only stack another layer once the deck below is covered.
    let layer = 0;
    let layerStart = 0;
    while (layer < PRODUCE_LAYERS.length - 1 && ordinal >= layerStart + PRODUCE_LAYERS[layer][0] * PRODUCE_LAYERS[layer][1]) {
      layerStart += PRODUCE_LAYERS[layer][0] * PRODUCE_LAYERS[layer][1];
      layer += 1;
    }
    const [columns, rows] = PRODUCE_LAYERS[layer];
    const layerOrdinal = ordinal - layerStart;
    const row = Math.min(rows - 1, Math.floor(layerOrdinal / columns));
    return produceDeckLocalPoint(
      produceBinColumn(productId) + (layerOrdinal % columns - (columns - 1) / 2) * PRODUCE_SLOT_GRID.columnPitch,
      PRODUCE_SLOT_GRID.unitLift + layer * PRODUCE_SLOT_GRID.layerLift,
      (row - (rows - 1) / 2) * PRODUCE_SLOT_GRID.rowPitch,
    );
  }

  const grid = RETAIL_SHELF_GRIDS[productId as keyof typeof RETAIL_SHELF_GRIDS];
  const front = shelfGridFrontCapacity(grid);
  const depthRow = Math.min(grid.depthRows - 1, Math.floor(ordinal / front));
  const frontOrdinal = ordinal - depthRow * front;
  const levelCount = grid.levels.length;
  const level = frontOrdinal % levelCount;
  const column = Math.floor(frontOrdinal / levelCount);
  // Units of this depth row and level that exist below shelfEnd, so a partial
  // row stays centred exactly like the rendered stock.
  const rowEnd = Math.min(front, Math.max(0, shelfEnd - depthRow * front));
  const rowCount = Math.min(grid.across, Math.max(column + 1, Math.ceil((rowEnd - level) / levelCount)));
  return [
    grid.originX + centeredSlot(column, rowCount, grid.pitch),
    grid.levels[level] + grid.lift,
    grid.frontZ - depthRow * grid.depthPitch,
  ];
}

export function stockingInteractionId(departmentId: RetailDepartmentId): StockingInteractionId {
  return `stock:${departmentId}`;
}

export function retailDepartmentFromStockingInteraction(id: string): RetailDepartmentId | null {
  if (!id.startsWith("stock:")) return null;
  const departmentId = id.slice("stock:".length) as RetailDepartmentId;
  return RETAIL_DEPARTMENT_IDS.includes(departmentId) ? departmentId : null;
}

export function isStockingInteractionId(id: string): id is StockingInteractionId {
  return retailDepartmentFromStockingInteraction(id) !== null;
}
