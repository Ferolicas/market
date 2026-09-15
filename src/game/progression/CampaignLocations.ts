import type { ProductId } from "../economy/ProductRegistry";
import type { ShoppingLine } from "../ai/CustomerBrain";

interface LocationProfile {
  specialty: string;
  focus: readonly ProductId[];
  masteryMultiplier: number;
  focusMultiplier: number;
  maximumTypes: number;
}

/** Original balance; all existing chains remain available in every location. */
export const CAMPAIGN_LOCATIONS = {
  barrio: { specialty: "Mercado de proximidad", focus: ["tomatoes", "eggs"], masteryMultiplier: 1, focusMultiplier: 1, maximumTypes: 3 },
  estacion: { specialty: "Desayunos y café", focus: ["coffee", "bread", "juice"], masteryMultiplier: 2, focusMultiplier: 3, maximumTypes: 3 },
  marina: { specialty: "Frutas y zumos", focus: ["apples", "oranges", "juice"], masteryMultiplier: 2, focusMultiplier: 4, maximumTypes: 3 },
  aeropuerto: { specialty: "Cestas variadas para viajeros", focus: ["coffee", "bread", "cheese", "juice"], masteryMultiplier: 3, focusMultiplier: 5, maximumTypes: 4 },
  campus: { specialty: "Lácteos y cereales", focus: ["milk", "cheese", "corn", "wheat", "flour"], masteryMultiplier: 3, focusMultiplier: 6, maximumTypes: 4 },
  megastore: { specialty: "Dominio de todo el surtido", focus: [], masteryMultiplier: 8, focusMultiplier: 8, maximumTypes: 5 },
} as const satisfies Record<string, LocationProfile>;

export function campaignLocation(id: string): LocationProfile {
  return CAMPAIGN_LOCATIONS[id as keyof typeof CAMPAIGN_LOCATIONS] ?? CAMPAIGN_LOCATIONS.barrio;
}

/** Level 4 completes the first chicken, so eggs reach the shelf with it. */
export const CAMPAIGN_EGG_LEVEL = 4;
/** Hard ceiling shared with the checkout and save budgets. */
export const CAMPAIGN_MAX_BASKET_UNITS = 15;

/**
 * Units one shopper buys: a single tomato before the eggs open, then four
 * units spread over every product on sale, plus one more every three levels.
 * The random shopper takes exactly one extra unit.
 */
export function campaignBasketUnits(level: number) {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const base = safeLevel < CAMPAIGN_EGG_LEVEL
    ? 1
    : 4 + Math.floor((safeLevel - CAMPAIGN_EGG_LEVEL) / 3);
  return { base: Math.min(CAMPAIGN_MAX_BASKET_UNITS - 1, base), bonus: 1 };
}

/** Shoppers on the floor at once: two until level 4, then one more every five. */
export function campaignCustomerLimit(level: number) {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  return Math.min(8, 2 + Math.floor(safeLevel / 5));
}

/**
 * Deterministic basket: every product on sale gets at least one unit while the
 * budget lasts, and the remainder goes to the location's speciality first, so
 * a shopper never walks past a stocked shelf with an empty slot in the list.
 */
export function campaignShoppingList(locationId: string, available: readonly ProductId[], seed: number, level: number): ShoppingLine[] {
  let value = seed >>> 0;
  const random = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 0x1_0000_0000; };
  const profile = campaignLocation(locationId);
  const candidates = [...new Set(available)];
  if (!candidates.length) return [];
  const budget = campaignBasketUnits(level);
  const total = Math.min(CAMPAIGN_MAX_BASKET_UNITS, budget.base + (random() < 0.5 ? budget.bonus : 0));
  const lines = new Map<ProductId, number>();
  const pool = [...candidates];
  // One unit each, in weighted order, for as many products as the budget holds.
  while (pool.length && lines.size < total) {
    const weights = pool.map((product) => profile.focus.includes(product) ? 3 : 1);
    let ticket = random() * weights.reduce((sum, weight) => sum + weight, 0);
    let index = 0;
    while (index < weights.length - 1 && ticket >= weights[index]) ticket -= weights[index++];
    lines.set(pool.splice(index, 1)[0], 1);
  }
  const ordered = [...lines.keys()];
  let remaining = total - ordered.length;
  while (remaining > 0) {
    const weights = ordered.map((product) => profile.focus.includes(product) ? 3 : 1);
    let ticket = random() * weights.reduce((sum, weight) => sum + weight, 0);
    let index = 0;
    while (index < weights.length - 1 && ticket >= weights[index]) ticket -= weights[index++];
    const product = ordered[index];
    lines.set(product, (lines.get(product) ?? 0) + 1);
    remaining -= 1;
  }
  return ordered.map((productId) => ({ productId, requested: lines.get(productId)!, picked: 0 }));
}
