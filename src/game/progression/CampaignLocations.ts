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

/** Weighted sampling without replacement: deterministic, no duplicated lines,
 * no locked products and at most 15 units, matching checkout/save budgets. */
export function campaignShoppingList(locationId: string, available: readonly ProductId[], seed: number, expanded: boolean): ShoppingLine[] {
  let value = seed >>> 0;
  const random = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 0x1_0000_0000; };
  const profile = campaignLocation(locationId);
  const candidates = [...new Set(available)];
  const count = Math.min(candidates.length, expanded ? 1 + Math.floor(random() * profile.maximumTypes) : 1);
  const result: ShoppingLine[] = [];
  for (let line = 0; line < count; line++) {
    const weights = candidates.map((product) => expanded && profile.focus.includes(product) ? 3 : 1);
    let ticket = random() * weights.reduce((sum, weight) => sum + weight, 0);
    let index = 0;
    while (index < weights.length - 1 && ticket >= weights[index]) ticket -= weights[index++];
    const [productId] = candidates.splice(index, 1);
    const requested = expanded ? 1 + Math.floor(random() * 3) : (seed >>> 0) % 5 === 0 ? 2 : 1;
    result.push({ productId, requested, picked: 0 });
  }
  return result;
}
