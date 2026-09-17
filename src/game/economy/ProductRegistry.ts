/** Persisted identifiers: client, simulation and server must agree on this list.
 * Extend only together with catalog, production, presentation and migration.
 * Never rename an existing identifier to introduce a different product. */
export const PRODUCT_IDS = [
  "wheat", "flour", "bread", "corn", "milk", "eggs", "cheese", "apples",
  "tomatoes", "oranges", "coffee", "juice", "cannedCorn",
] as const;

export type ProductId = (typeof PRODUCT_IDS)[number];

export const CROP_PRODUCT_IDS = ["tomatoes", "apples", "oranges", "wheat", "corn", "coffee"] as const satisfies readonly ProductId[];
export type CropProductId = (typeof CROP_PRODUCT_IDS)[number];

export const MACHINE_PRODUCT_IDS = ["flour", "bread", "cheese", "juice", "eggs", "milk", "cannedCorn"] as const satisfies readonly ProductId[];
export type MachineProductId = (typeof MACHINE_PRODUCT_IDS)[number];

const productIds = new Set<string>(PRODUCT_IDS);
export function isProductId(value: unknown): value is ProductId {
  return typeof value === "string" && productIds.has(value);
}

export function createEmptyInventory(): Record<ProductId, number> {
  return Object.fromEntries(PRODUCT_IDS.map((id) => [id, 0])) as Record<ProductId, number>;
}
