import type { ProductId } from "../types";

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
export const PANTRY_DISPLAY_POSITIONS = [
  [0, 0, 1.4],
  [0, 0, -0.9],
  [0, 0, -3.2],
] as const;
export const PRODUCE_DISPLAY_POSITIONS = [
  [-4.55, 0, 4.1 - 4 * INDIVIDUAL_FLOOR_TILE_LAYOUT],
  [-7.3, 0, 4.1 - 4 * INDIVIDUAL_FLOOR_TILE_LAYOUT],
] as const;

export const RETAIL_DEPARTMENTS: Record<RetailDepartmentId, RetailDepartment> = {
  // Service points remain useful route destinations, but the actual stocking
  // volume wraps the complete fixture footprint so every walkable side works.
  bakery: { id: "bakery", label: "PAN Y HARINAS", color: "#b96d39", display: [-4.3, 0, -5], yaw: 90, fixtureHalfExtents: [1.2, 0.78], service: [-3.05, -5], products: ["bread", "flour", "wheat"] },
  pantry: { id: "pantry", label: "DESPENSA", color: "#6f4938", display: [...PANTRY_DISPLAY_POSITIONS[0]], yaw: 0, fixtureHalfExtents: [1.2, 0.78], service: [0, 2.75], products: ["coffee"] },
  eggs: { id: "eggs", label: "HUEVOS", color: "#d49a34", display: [-10.25, 0, -1.75], yaw: 0, fixtureHalfExtents: [1.2, 0.78], service: [-10.25, -0.4], products: ["eggs"] },
  produce: { id: "produce", label: "FRUTAS Y VERDURAS", color: "#3f7b4c", display: [...PRODUCE_DISPLAY_POSITIONS[0]], yaw: 0, fixtureHalfExtents: [1.25, 0.83], service: [-4.55, 4.1 - 4 * INDIVIDUAL_FLOOR_TILE_LAYOUT - 1.35], products: ["tomatoes", "apples", "oranges", "corn"] },
  dairy: { id: "dairy", label: "LÁCTEOS", color: "#4382a1", display: [-10.34, 0, 0.45 + 3 * INDIVIDUAL_FLOOR_TILE_LAYOUT], yaw: -90, fixtureHalfExtents: [1.25, 0.83], service: [-9.24, 0.45 + 3 * INDIVIDUAL_FLOOR_TILE_LAYOUT], products: ["milk", "cheese"] },
  drinks: { id: "drinks", label: "BEBIDAS", color: "#cc6841", display: [4.35, 0, -0.9], yaw: -90, fixtureHalfExtents: [1.18, 0.8], service: [3.25, -0.9], products: ["juice"] },
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
/** Unit slots inside one bin: three across, five deep, then a second layer. */
export const PRODUCE_SLOT_GRID = { columns: 3, rows: 5, columnPitch: 0.15, rowPitch: 0.19, unitLift: 0.11, layerLift: 0.14 } as const;

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

/** Every tier-10 authoritative shelf still has a visible physical slot. */
export const RETAIL_VISUAL_CAPACITY: Record<ProductId, number> = {
  bread: 18,
  flour: 26,
  wheat: 26,
  coffee: 40,
  eggs: 24,
  tomatoes: 26,
  apples: 26,
  oranges: 26,
  corn: 26,
  milk: 25,
  cheese: 25,
  juice: 45,
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

export function retailServicePoint(productId: ProductId): [number, number] {
  return [...RETAIL_DEPARTMENTS[PRODUCT_RETAIL_DEPARTMENT[productId]].service];
}

export function retailDisplayPosition(departmentId: RetailDepartmentId): [number, number, number] {
  return [...RETAIL_DEPARTMENTS[departmentId].display];
}

/** Complete rounded-rectangle stocking volume in scaled simulation units. */
export function retailStockingMagnet(
  departmentId: RetailDepartmentId,
  layoutScale: number,
  elementScale: number,
) {
  const department = RETAIL_DEPARTMENTS[departmentId];
  const quarterTurn = Math.abs(department.yaw ?? 0) % 180 === 90;
  return {
    x: department.display[0] * layoutScale,
    z: department.display[2] * layoutScale,
    halfExtents: [
      department.fixtureHalfExtents[quarterTurn ? 1 : 0] * elementScale,
      department.fixtureHalfExtents[quarterTurn ? 0 : 1] * elementScale,
    ] as const,
    enterRadius: RETAIL_STOCKING_MAGNET_REACH.enter * elementScale,
    exitRadius: RETAIL_STOCKING_MAGNET_REACH.exit * elementScale,
  };
}

function rowCount(total: number, row: number, perRow: number) {
  return Math.min(perRow, Math.max(0, total - row * perRow));
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

  if (productId === "bread") {
    const perRow = 8;
    const logicalRow = Math.floor(ordinal / perRow);
    const row = Math.min(2, logicalRow);
    const fixtureLevel = row === 2 ? RETAIL_FIXTURE_LEVELS.bakery[4] : RETAIL_FIXTURE_LEVELS.bakery[row];
    const count = rowCount(shelfEnd, row, perRow);
    return [centeredSlot(ordinal % perRow, count, 0.22), fixtureLevel + 0.14, -0.05];
  }
  if (productId === "flour" || productId === "wheat") {
    const perDepthRow = 12;
    const depthRow = Math.min(2, Math.floor(ordinal / perDepthRow));
    const count = rowCount(shelfEnd, depthRow, perDepthRow);
    const level = productId === "flour" ? RETAIL_FIXTURE_LEVELS.bakery[2] : RETAIL_FIXTURE_LEVELS.bakery[3];
    return [centeredSlot(ordinal % perDepthRow, count, 0.15), level + 0.14, -0.05 + depthRow * 0.12];
  }
  if (productId === "coffee") {
    const perRow = 8;
    const row = Math.min(RETAIL_FIXTURE_LEVELS.pantry.length - 1, Math.floor(ordinal / perRow));
    const count = rowCount(shelfEnd, row, perRow);
    return [centeredSlot(ordinal % perRow, count, 0.19), RETAIL_FIXTURE_LEVELS.pantry[row] + 0.14, 0.26];
  }
  if (productId === "eggs") {
    const perRow = 6;
    const row = Math.min(RETAIL_FIXTURE_LEVELS.eggs.length - 1, Math.floor(ordinal / perRow));
    return [(ordinal % perRow - 2.5) * 0.19, RETAIL_FIXTURE_LEVELS.eggs[row] + 0.205, 0.18];
  }
  if (productId === "milk" || productId === "cheese") {
    const perRow = 5;
    const row = Math.min(RETAIL_FIXTURE_LEVELS.dairy.length - 1, Math.floor(ordinal / perRow));
    const count = rowCount(shelfEnd, row, perRow);
    return [(productId === "milk" ? -0.55 : 0.55) + centeredSlot(ordinal % perRow, count, 0.17), RETAIL_FIXTURE_LEVELS.dairy[row] + 0.14, 0.2];
  }
  if (productId === "juice") {
    const perRow = 9;
    const row = Math.min(RETAIL_FIXTURE_LEVELS.drinks.length - 1, Math.floor(ordinal / perRow));
    const count = rowCount(shelfEnd, row, perRow);
    return [centeredSlot(ordinal % perRow, count, 0.2), RETAIL_FIXTURE_LEVELS.drinks[row] + 0.14, 0.21];
  }

  // Produce: every SKU owns one bin. Units fill it back to front, three
  // across, and only stack a second layer once the deck is covered.
  const { columns, rows, columnPitch, rowPitch, unitLift, layerLift } = PRODUCE_SLOT_GRID;
  const layerCapacity = columns * rows;
  const layer = ordinal < layerCapacity ? 0 : 1;
  const layerOrdinal = ordinal - layer * layerCapacity;
  const layerRows = layer === 0 ? rows : rows - 1;
  const row = Math.min(layerRows - 1, Math.floor(layerOrdinal / columns));
  return produceDeckLocalPoint(
    produceBinColumn(productId) + (layerOrdinal % columns - (columns - 1) / 2) * columnPitch,
    unitLift + layer * layerLift,
    (row - (layerRows - 1) / 2) * rowPitch,
  );
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
