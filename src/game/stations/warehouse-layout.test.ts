import { describe, expect, it } from "vitest";
import { ensureStoreNavigation, isStoreNavigationPoint, storePathfinder } from "../navigation/NavMeshService";
import { overlapsStoreObstacle, scaleStorePoint, STORE_LAYOUT_SCALE } from "../world-scale";
import { WAREHOUSE_PICKUP_STATION } from "./warehouse-layout";

describe("warehouse pickup layout", () => {
  it("keeps the invisible pickup sensor on an accessible Recast cell beside the real dock", async () => {
    const point: [number, number] = [WAREHOUSE_PICKUP_STATION.position[0], WAREHOUSE_PICKUP_STATION.position[2]];

    expect(isStoreNavigationPoint(point)).toBe(true);
    expect(overlapsStoreObstacle(scaleStorePoint(point), 0.31 * STORE_LAYOUT_SCALE)).toBe(false);
    expect(await ensureStoreNavigation(1)).toBe(true);
    const route = storePathfinder([0, 6.25], point);
    expect(route.length).toBeGreaterThan(1);
    expect(Math.hypot((route.at(-1)?.[0] ?? 99) - point[0], (route.at(-1)?.[1] ?? 99) - point[1])).toBeLessThan(0.12);
    expect(WAREHOUSE_PICKUP_STATION.interactionId).toBe("supplier");
    expect(WAREHOUSE_PICKUP_STATION.repeatEveryMs).toBeGreaterThan(0);
  });
});
