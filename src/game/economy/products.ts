import { z } from "zod";
import type { ProductId } from "../types";

const productConfigSchema = z.object({
  id: z.string(),
  growMs: z.number().int().nonnegative().optional(),
  cycleMs: z.number().int().positive().optional(),
  yield: z.number().int().positive(),
  saleMinor: z.number().int().nonnegative().optional(),
  shelfCapacity: z.number().int().positive().optional(),
  recipe: z.record(z.string(), z.number().int().positive()).optional(),
});

export type ProductConfig = z.infer<typeof productConfigSchema> & { id: ProductId };

const rawProducts: ProductConfig[] = [
  { id: "tomatoes", growMs: 4_000, yield: 1, saleMinor: 400, shelfCapacity: 12 },
  { id: "wheat", growMs: 6_000, yield: 1 },
  { id: "corn", growMs: 7_000, yield: 1, saleMinor: 700, shelfCapacity: 12 },
  { id: "eggs", cycleMs: 8_000, yield: 1, saleMinor: 900, shelfCapacity: 10 },
  { id: "milk", cycleMs: 10_000, yield: 1, saleMinor: 1_000, shelfCapacity: 10 },
  { id: "flour", cycleMs: 4_000, yield: 1, recipe: { wheat: 2 } },
  { id: "bread", cycleMs: 6_000, yield: 1, saleMinor: 1_400, shelfCapacity: 8, recipe: { flour: 1 } },
  { id: "cheese", cycleMs: 8_000, yield: 1, saleMinor: 2_600, shelfCapacity: 8, recipe: { milk: 2 } },
  { id: "juice", cycleMs: 5_000, yield: 1, saleMinor: 1_100, shelfCapacity: 8, recipe: { tomatoes: 2 } },
];

export const PRODUCT_CONFIG = Object.fromEntries(rawProducts.map((product) => {
  const parsed = productConfigSchema.parse(product) as ProductConfig;
  return [parsed.id, parsed];
})) as Partial<Record<ProductId, ProductConfig>>;
