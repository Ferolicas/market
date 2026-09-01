import { beforeAll, describe, expect, it } from "vitest";
import { FARM_ACCESS_WAYPOINTS, FARM_ANIMAL_STATIONS, FARM_FIELD, FARM_GATE, FARM_PLOTS } from "../stations/farm-layout";
import { CART_RETURN_POINT, RETURNS_POINT } from "../stations/store-service-layout";
import { STORE_REAR_DOOR } from "../stations/storefront-layout";
import { ensureStoreNavigation, isStoreNavigationPoint, STORE_NAVIGATION_BOUNDS, storePathfinder } from "./NavMeshService";

function pathLength(start: readonly [number, number], path: readonly (readonly [number, number])[]) {
  return path.reduce((total, point, index) => {
    const previous = index === 0 ? start : path[index - 1];
    return total + Math.hypot(point[0] - previous[0], point[1] - previous[1]);
  }, 0);
}

function crossingXAtZ(start: readonly [number, number], path: readonly (readonly [number, number])[], z: number) {
  const points = [start, ...path];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    if ((previous[1] - z) * (next[1] - z) > 0 || Math.abs(next[1] - previous[1]) < 1e-8) continue;
    const progress = (z - previous[1]) / (next[1] - previous[1]);
    if (progress >= 0 && progress <= 1) return previous[0] + (next[0] - previous[0]) * progress;
  }
  return null;
}

describe("store and rear-farm navigation", () => {
  beforeAll(async () => {
    expect(await ensureStoreNavigation(92_001)).toBe(true);
  });

  it("models both authored doors and keeps the remaining building walls solid", () => {
    expect(isStoreNavigationPoint([0, 7.8])).toBe(true);
    expect(isStoreNavigationPoint([4, 7.8])).toBe(false);
    expect(isStoreNavigationPoint([STORE_REAR_DOOR.x, STORE_REAR_DOOR.z])).toBe(true);
    expect(isStoreNavigationPoint([STORE_REAR_DOOR.x - 3, STORE_REAR_DOOR.z])).toBe(false);
    expect(isStoreNavigationPoint([11.35, 0])).toBe(false);
    expect(isStoreNavigationPoint([12.15, 7.8])).toBe(true);
    expect(isStoreNavigationPoint([12.15, 0])).toBe(true);
    expect(isStoreNavigationPoint([12.15, -8.45])).toBe(true);
  });

  it("extends beyond the rear field without wasting navigation area", () => {
    const fieldRearEdge = FARM_FIELD.center[2] - FARM_FIELD.size[2] / 2;
    expect(STORE_NAVIGATION_BOUNDS.minZ).toBeLessThan(fieldRearEdge);
    expect(STORE_NAVIGATION_BOUNDS.minZ).toBeGreaterThan(fieldRearEdge - 0.75);
    expect(STORE_NAVIGATION_BOUNDS.maxX).toBeGreaterThan(FARM_FIELD.serviceLaneX);
  });

  it("blocks the direct side escapes between the rear wall and the farm", () => {
    FARM_GATE.sideConnectors.forEach((connector) => {
      expect(isStoreNavigationPoint([connector.center[0], connector.center[2]])).toBe(false);
      const outside = [Math.sign(connector.center[0]) * 12.15, connector.center[2]] as [number, number];
      const path = storePathfinder([...STORE_REAR_DOOR.outsideApproach], outside);
      expect(pathLength(STORE_REAR_DOOR.outsideApproach, path)).toBeGreaterThan(12);
    });
  });

  it("routes directly through the rear door to every farm destination", () => {
    const start: [number, number] = [0, 6.25];
    const destinations: [string, [number, number]][] = [
      ...FARM_PLOTS.map((plot): [string, [number, number]] => [plot.id, [plot.position[0], plot.position[2]]]),
      ...Object.entries(FARM_ANIMAL_STATIONS).map(([id, station]): [string, [number, number]] => [id, [station.workPosition[0], station.workPosition[2]]]),
    ];

    destinations.forEach(([id, destination]) => {
      const path = storePathfinder(start, destination);
      expect(path.length, `${id} needs a complete route`).toBeGreaterThan(3);
      expect(Math.hypot(path.at(-1)![0] - destination[0], path.at(-1)![1] - destination[1]), `${id} endpoint`).toBeLessThan(0.9);
      expect(path.some(([x]) => x > 11.58), `${id} cannot circle around the exterior lane`).toBe(false);
      const crossingX = crossingXAtZ(start, path, STORE_REAR_DOOR.z);
      expect(crossingX, `${id} must cross the rear wall`).not.toBeNull();
      expect(Math.abs(crossingX! - STORE_REAR_DOOR.x), `${id} rear-door alignment`).toBeLessThan(STORE_REAR_DOOR.door.outerPostOffset - STORE_REAR_DOOR.door.postWidth / 2);
      expect(pathLength(start, path), `${id} rear-door detour`).toBeLessThan(40);
    });
  });

  it("projects every authored farm-access waypoint within the player's strict arrival tolerance", () => {
    FARM_ACCESS_WAYPOINTS.slice(1).forEach((destination, index) => {
      const start = FARM_ACCESS_WAYPOINTS[index];
      const path = storePathfinder([...start], [...destination]);
      expect(path.length, `access ${index} route`).toBeGreaterThan(1);
      expect(
        Math.hypot(path.at(-1)![0] - destination[0], path.at(-1)![1] - destination[1]),
        `access ${index} endpoint projection`,
      ).toBeLessThan(0.25);
    });
  });

  it("keeps entrance, checkout, returns and cart-bay sockets connected outside solid fixtures", () => {
    const cases = [
      { id: "entrance-cart", start: [0, 6.25], destination: [...CART_RETURN_POINT], maxLength: 5 },
      { id: "checkout-returns", start: [7, 2.85], destination: [...RETURNS_POINT], maxLength: 7 },
      { id: "returns-cart", start: [...RETURNS_POINT], destination: [...CART_RETURN_POINT], maxLength: 19 },
      { id: "cart-entrance", start: [...CART_RETURN_POINT], destination: [0, 6.25], maxLength: 5 },
    ] satisfies { id: string; start: [number, number]; destination: [number, number]; maxLength: number }[];

    expect(isStoreNavigationPoint(RETURNS_POINT)).toBe(true);
    expect(isStoreNavigationPoint(CART_RETURN_POINT)).toBe(true);
    cases.forEach(({ id, start, destination, maxLength }) => {
      const path = storePathfinder(start, destination);
      expect(path.length, `${id} route`).toBeGreaterThan(1);
      expect(path.every(isStoreNavigationPoint), `${id} waypoints`).toBe(true);
      expect(Math.hypot(path.at(-1)![0] - destination[0], path.at(-1)![1] - destination[1]), `${id} endpoint`).toBeLessThan(0.9);
      expect(pathLength(start, path), `${id} detour`).toBeLessThan(maxLength);
    });
  });
});
