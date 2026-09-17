import type { ProductId } from "./ProductRegistry";

/** Every existing product must retain a working supply route and customer demand.
 * Legacy levels remain here until the purchase campaign replaces them atomically. */
export const PRODUCT_SUPPLY = {
  tomatoes: { kind: "crop", stationId: "crop-tomato-1", legacyLevel: 1 },
  apples: { kind: "crop", stationId: "crop-apple-1", legacyLevel: 2 },
  wheat: { kind: "crop", stationId: "crop-wheat-1", legacyLevel: 4 },
  flour: { kind: "machine", stationId: "flour-mill-1", legacyLevel: 5 },
  bread: { kind: "machine", stationId: "bread-oven-1", legacyLevel: 6 },
  eggs: { kind: "animal", stationId: "chicken-coop-1", legacyLevel: 8 },
  coffee: { kind: "crop", stationId: "crop-coffee-1", legacyLevel: 9 },
  corn: { kind: "crop", stationId: "crop-corn-1", legacyLevel: 11 },
  milk: { kind: "animal", stationId: "cow-station-1", legacyLevel: 13 },
  cheese: { kind: "machine", stationId: "cheese-maker-1", legacyLevel: 16 },
  oranges: { kind: "crop", stationId: "crop-orange-1", legacyLevel: 20 },
  juice: { kind: "machine", stationId: "juice-machine-1", legacyLevel: 21 },
  cannedCorn: { kind: "supplier", supplierId: "campo", legacyLevel: 31 },
} as const satisfies Record<ProductId,
  { kind: "crop" | "machine" | "animal"; stationId: string; legacyLevel: number }
  | { kind: "supplier"; supplierId: string; legacyLevel: number }>;

export const CUSTOMER_PRODUCT_UNLOCKS = (Object.entries(PRODUCT_SUPPLY) as [ProductId, (typeof PRODUCT_SUPPLY)[ProductId]][])
  .map(([product, supply]) => [product, supply.legacyLevel] as const);
