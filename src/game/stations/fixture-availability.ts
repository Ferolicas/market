const REQUIRED_AREAS: Record<string, string> = {
  "fixture:flour-mill": "flour-mill", "fixture:bread-oven": "bread-oven",
  "fixture:cheese-maker": "cheese-maker", "fixture:juice-machine": "juice-machine",
  "fixture:checkout-2": "checkout-2", "fixture:chicken-coop": "chicken-coop",
  "fixture:chicken-coop-2": "chicken-coop-2", "fixture:cow-station": "cow-station",
};

/** One rule for rendering, Rapier and navigation. Legacy scenes stay unchanged. */
export function fixtureAvailable(id: string | undefined, areas: readonly string[] = []): boolean {
  if (id === "fixture:corn-canner") return areas.includes("corn-canner");
  if (id?.startsWith("fixture:retail-preserves-")) return areas.includes("preserves-supply");
  if (!areas.includes("purchase-campaign") || !id) return true;
  const has = (area: string) => areas.includes(area);
  if (id === "fixture:retail-produce-2") return has("expansion-side");
  if (id.startsWith("fixture:production-cubicle-")) return has("flour-mill");
  if (id.startsWith("fixture:retail-pantry-")) return has("coffee-supply");
  if (id.startsWith("fixture:retail-bakery-")) return has("farm-wheat");
  if (id.startsWith("fixture:retail-eggs-")) return has("egg-display");
  if (id.startsWith("fixture:retail-dairy-")) return has("dairy-display");
  if (id.startsWith("fixture:retail-drinks-")) return has("juice-machine");
  return !REQUIRED_AREAS[id] || has(REQUIRED_AREAS[id]);
}
