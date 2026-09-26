import { describe, expect, it } from "vitest";
import { fixtureAvailable } from "./fixture-availability";
import { STORE_OBSTACLES, STORE_LAYOUT_SCALE, storeObstaclesForAreas } from "../world-scale";
import { ensureStoreNavigation, isStoreNavigationPoint, storePathfinder } from "../navigation/NavMeshService";

const opening = ["purchase-campaign"];
const cases = [
  ["fixture:corn-canner", "corn-canner"],
  ["fixture:retail-preserves-1", "preserves-supply"],
  ["fixture:retail-eggs-1", "egg-display"],
  ["fixture:retail-produce-2", "expansion-side"],
  ["fixture:retail-dairy-1", "dairy-display"],
  ["fixture:retail-pantry-1", "coffee-supply"],
  ["fixture:retail-bakery-1", "farm-wheat"],
  ["fixture:retail-drinks-1", "juice-machine"],
  ["fixture:flour-mill", "flour-mill"],
  ["fixture:bread-oven", "bread-oven"],
  ["fixture:cheese-maker", "cheese-maker"],
  ["fixture:juice-machine", "juice-machine"],
  ["fixture:checkout-2", "checkout-2"],
  ["fixture:checkout-3", "checkout-3"],
  ["fixture:chicken-coop", "chicken-coop"],
  ["fixture:chicken-coop-2", "chicken-coop-2"],
  ["fixture:cow-station", "cow-station"],
] as const;

describe("purchased fixtures share geometry and obstacle availability", () => {
  it.each(cases)("opens and closes %s with %s", (id, area) => {
    expect(fixtureAvailable(id, opening)).toBe(false);
    expect(storeObstaclesForAreas(opening).some((obstacle) => obstacle.id === id)).toBe(false);
    expect(fixtureAvailable(id, [...opening, area])).toBe(true);
    expect(storeObstaclesForAreas([...opening, area]).some((obstacle) => obstacle.id === id)).toBe(true);
    const obstacle = STORE_OBSTACLES.find((candidate) => candidate.id === id)!;
    const center: [number, number] = [obstacle.x / STORE_LAYOUT_SCALE, obstacle.z / STORE_LAYOUT_SCALE];
    expect(isStoreNavigationPoint(center, [...opening, area])).toBe(false);
  });
  it("keeps legacy fixtures and leaves the unopened egg department walkable", () => {
    expect(storeObstaclesForAreas()).toEqual(STORE_OBSTACLES.filter((obstacle) => !["fixture:retail-preserves-1", "fixture:corn-canner"].includes(obstacle.id ?? "")));
    const obstacle = STORE_OBSTACLES.find((candidate) => candidate.id === "fixture:retail-eggs-1")!;
    expect(isStoreNavigationPoint([obstacle.x / STORE_LAYOUT_SCALE, obstacle.z / STORE_LAYOUT_SCALE], opening)).toBe(true);
  });
  it("rebuilds when the set of available fixtures actually changes", async () => {
    const obstacle = STORE_OBSTACLES.find((candidate) => candidate.id === "fixture:retail-eggs-1")!;
    const center: [number, number] = [obstacle.x / STORE_LAYOUT_SCALE, obstacle.z / STORE_LAYOUT_SCALE];
    expect(await ensureStoreNavigation(opening)).toBe(true);
    const path = storePathfinder([center[0], center[1] + 2], center);
    expect(path.length).toBeGreaterThan(0);
    expect(Math.hypot(path.at(-1)![0] - center[0], path.at(-1)![1] - center[1])).toBeLessThan(0.2);
    expect(await ensureStoreNavigation([...opening, "egg-display"])).toBe(true);
    const blockedPath = storePathfinder([center[0], center[1] + 2], center);
    expect(blockedPath.length === 0 || Math.hypot(blockedPath.at(-1)![0] - center[0], blockedPath.at(-1)![1] - center[1]) > 0.2).toBe(true);
    expect(await ensureStoreNavigation(opening)).toBe(true);
    const restored = storePathfinder([center[0], center[1] + 2], center);
    expect(restored.length).toBeGreaterThan(0);
    expect(Math.hypot(restored.at(-1)![0] - center[0], restored.at(-1)![1] - center[1])).toBeLessThan(0.2);
  });
});
