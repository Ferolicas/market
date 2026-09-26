import { describe, expect, it } from "vitest";
import { ensureStoreNavigation, isStoreNavigationPoint, storePathfinder } from "../navigation/NavMeshService";
import { overlapsStoreObstacle, scaleStorePoint, STORE_LAYOUT_SCALE } from "../world-scale";
import { WAREHOUSE_ORDERS_TERMINAL, WAREHOUSE_RETURN_STATION } from "./warehouse-layout";

describe("warehouse orders terminal layout", () => {
  it("keeps the orders terminal on an accessible Recast cell beside the real dock", async () => {
    const point: [number, number] = [WAREHOUSE_ORDERS_TERMINAL.position[0], WAREHOUSE_ORDERS_TERMINAL.position[2]];

    expect(isStoreNavigationPoint(point)).toBe(true);
    expect(overlapsStoreObstacle(scaleStorePoint(point), 0.31 * STORE_LAYOUT_SCALE)).toBe(false);
    expect(await ensureStoreNavigation([])).toBe(true);
    const route = storePathfinder([0, 6.25], point);
    expect(route.length).toBeGreaterThan(1);
    expect(Math.hypot((route.at(-1)?.[0] ?? 99) - point[0], (route.at(-1)?.[1] ?? 99) - point[1])).toBeLessThan(0.12);
    expect(WAREHOUSE_ORDERS_TERMINAL.label).toBe("Pedidos y almacén");
  });
});

describe("warehouse return layout", () => {
  it("keeps the worker return point reachable beside the rear farm door", async () => {
    const point: [number, number] = [WAREHOUSE_RETURN_STATION.position[0], WAREHOUSE_RETURN_STATION.position[2]];

    expect(await ensureStoreNavigation([])).toBe(true);
    const approach: [number, number] = [...WAREHOUSE_RETURN_STATION.workerPosition];
    expect(isStoreNavigationPoint(approach)).toBe(true);
    expect(overlapsStoreObstacle(scaleStorePoint(approach), 0.31 * STORE_LAYOUT_SCALE)).toBe(false);
    const route = storePathfinder([0, 6.25], approach);
    expect(route.length).toBeGreaterThan(1);
    expect(Math.hypot((route.at(-1)?.[0] ?? 99) - approach[0], (route.at(-1)?.[1] ?? 99) - approach[1])).toBeLessThan(0.12);

    expect(overlapsStoreObstacle(scaleStorePoint(point), 0)).toBe(true);
    expect(WAREHOUSE_RETURN_STATION.interactionId).toBe("warehouseReturn");
    expect(WAREHOUSE_RETURN_STATION.repeatEveryMs).toBeGreaterThan(0);
  });
});
