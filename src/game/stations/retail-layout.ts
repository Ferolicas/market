import type { ProductId } from "../types";

export type RetailDepartmentId = "bakery" | "pantry" | "eggs" | "produce" | "dairy" | "drinks";
export type StockingInteractionId = `stock:${RetailDepartmentId}`;

export interface RetailDepartment {
  id: RetailDepartmentId;
  label: string;
  color: string;
  display: readonly [number, number, number];
  service: readonly [number, number];
  products: readonly ProductId[];
}

export const RETAIL_DEPARTMENTS: Record<RetailDepartmentId, RetailDepartment> = {
  // Service points stay on a generated NavMesh cell, outside the padded
  // furniture footprint. The interaction radius reaches the display from
  // that walkable lane; moving the sensor closer can make it unreachable.
  bakery: { id: "bakery", label: "PAN Y HARINAS", color: "#b96d39", display: [-4, 0, -2.2], service: [-4, -0.88], products: ["bread", "flour", "wheat"] },
  pantry: { id: "pantry", label: "DESPENSA", color: "#6f4938", display: [0, 0, -2.2], service: [0, -0.88], products: ["coffee"] },
  eggs: { id: "eggs", label: "HUEVOS", color: "#d49a34", display: [4, 0, -2.2], service: [4, -0.88], products: ["eggs"] },
  produce: { id: "produce", label: "FRUTAS Y VERDURAS", color: "#3f7b4c", display: [-4.1, 0, 2.45], service: [-4.1, 1.08], products: ["tomatoes", "apples", "corn"] },
  dairy: { id: "dairy", label: "LÁCTEOS", color: "#4382a1", display: [0, 0, 2.45], service: [0, 3.82], products: ["milk", "cheese"] },
  drinks: { id: "drinks", label: "BEBIDAS", color: "#cc6841", display: [4.05, 0, 2.45], service: [4.05, 3.82], products: ["juice"] },
};

export const RETAIL_DEPARTMENT_IDS = Object.keys(RETAIL_DEPARTMENTS) as RetailDepartmentId[];

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
  corn: 26,
  milk: 25,
  cheese: 25,
  juice: 45,
};

export const PRODUCT_RETAIL_DEPARTMENT: Record<ProductId, RetailDepartmentId> = {
  tomatoes: "produce",
  apples: "produce",
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

  const productColumn = productId === "tomatoes" ? 0 : productId === "apples" ? 1 : 2;
  if (ordinal < 9) {
    const row = Math.floor(ordinal / 3);
    const angle = 0.17;
    const innerY = row * 0.055;
    const innerZ = (row - 1) * 0.17;
    return [
      [-0.76, 0, 0.76][productColumn] + (ordinal % 3 - 1) * 0.16,
      0.88 + Math.cos(angle) * innerY - Math.sin(angle) * innerZ,
      -0.31 + Math.sin(angle) * innerY + Math.cos(angle) * innerZ,
    ];
  }
  const raisedOrdinal = ordinal - 9;
  const row = Math.floor(raisedOrdinal / 4);
  const angle = 0.08;
  const innerY = row * 0.035;
  const innerZ = (row - 2) * 0.1;
  return [
    (productColumn - 1) * 0.53 + (raisedOrdinal % 4 - 1.5) * 0.12,
    1.27 + Math.cos(angle) * innerY - Math.sin(angle) * innerZ,
    0.29 + Math.sin(angle) * innerY + Math.cos(angle) * innerZ,
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
