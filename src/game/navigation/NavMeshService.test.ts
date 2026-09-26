import { init, exportNavMesh } from "recast-navigation";
import { threeToSoloNavMesh } from "@recast-navigation/three";
import { Mesh, MeshBasicMaterial } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FARM_ACCESS_WAYPOINTS, FARM_ANIMAL_STATIONS, FARM_FIELD, FARM_GATE, FARM_PLOTS } from "../stations/farm-layout";
import { CART_RETURN_POINT, RETURNS_POINT } from "../stations/store-service-layout";
import { STORE_REAR_DOOR } from "../stations/storefront-layout";
import { ensureStoreNavigation, isStoreNavigationPoint, isStoreNavigationReady, NavMeshService, STORE_NAVIGATION_BOUNDS, storePathfinder } from "./NavMeshService";
import { createWalkableStoreGeometry } from "./walkable-geometry";

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

function crossingsZAtX(start: readonly [number, number], path: readonly (readonly [number, number])[], x: number) {
  const points = [start, ...path];
  const crossings: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    if ((previous[0] - x) * (next[0] - x) > 0 || Math.abs(next[0] - previous[0]) < 1e-8) continue;
    const progress = (x - previous[0]) / (next[0] - previous[0]);
    if (progress >= 0 && progress <= 1) crossings.push(previous[1] + (next[1] - previous[1]) * progress);
  }
  return crossings;
}

describe("store and rear-farm navigation", () => {
  beforeAll(async () => {
    expect(await ensureStoreNavigation([])).toBe(true);
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

  it("keeps both lateral passages inaccessible from the rear-door chute", () => {
    const start = [...STORE_REAR_DOOR.outsideApproach] as [number, number];
    FARM_GATE.accessCorridorFences.forEach((fence) => {
      expect(isStoreNavigationPoint([fence.center[0], fence.center[2]])).toBe(false);
      const lateralPocket = [fence.center[0] + fence.side * 1.2, fence.center[2]] as [number, number];
      const path = storePathfinder(start, lateralPocket);
      const crossings = crossingsZAtX(start, path, fence.center[0]);
      const gateEndZ = FARM_GATE.center[2];
      const doorEndZ = STORE_REAR_DOOR.z - STORE_REAR_DOOR.door.frameDepth / 2;
      const endpointDistance = Math.hypot(path.at(-1)![0] - lateralPocket[0], path.at(-1)![1] - lateralPocket[1]);

      expect(path.length).toBeGreaterThan(1);
      expect(endpointDistance).toBeGreaterThan(0.9);
      expect(crossings.some((z) => z > gateEndZ && z < doorEndZ)).toBe(false);
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
      // A nearby destination can need only three corners; endpoint and doorway
      // crossing below prove completeness, not an arbitrary minimum detour.
      expect(path.length, `${id} needs a complete route`).toBeGreaterThanOrEqual(3);
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
      expect(path.every((point) => isStoreNavigationPoint(point)), `${id} waypoints`).toBe(true);
      expect(Math.hypot(path.at(-1)![0] - destination[0], path.at(-1)![1] - destination[1]), `${id} endpoint`).toBeLessThan(0.9);
      expect(pathLength(start, path), `${id} detour`).toBeLessThan(maxLength);
    });
  });
});

/**
 * The navmesh's cache key is the availability of every static obstacle
 * (`fixtureAvailable` over `STORE_OBSTACLES`), not a generic counter the
 * caller bumps for unrelated reasons. `applyPurchaseContent()` used to bump
 * `franchise.structureRevision` unconditionally on every purchase, forcing a
 * real ~30 ms Recast rebuild even for purchases that never touch
 * `unlockedAreas` (player-2, farmer-1/2/3, machine tier upgrades) or that add
 * an area no obstacle is gated on (the crop purchases: tomato-2/3, apple-1,
 * corn-1, orange-1 push a "farm-*" zone nothing in `fixtureAvailable` reads).
 * These tests spy on `NavMeshService.prototype.rebuild` (still calling
 * through to the real implementation) to prove the fix at the level that
 * actually matters: whether Recast runs again, not what number a caller
 * happened to pass in.
 */
describe("navmesh rebuilds only when a real obstacle's availability changes", () => {
  const CAMPAIGN_BASE = ["purchase-campaign"];

  it("does not rebuild for a stat-only purchase, a machine tier bump, or a farmer hire", async () => {
    await ensureStoreNavigation(CAMPAIGN_BASE);
    const rebuildSpy = vi.spyOn(NavMeshService.prototype, "rebuild");
    // Same `unlockedAreas` every time: exactly what player-2 (stats only),
    // a chicken/cow tier-2/3 upgrade (existing machine, same footprint) and
    // farmer-1/2/3 (no area(), no machine()) each produce in production.
    await ensureStoreNavigation(CAMPAIGN_BASE);
    await ensureStoreNavigation([...CAMPAIGN_BASE]);
    await ensureStoreNavigation(Array.from(CAMPAIGN_BASE));
    expect(rebuildSpy).not.toHaveBeenCalled();
    rebuildSpy.mockRestore();
  });

  it("does not rebuild for an area that gates no obstacle at all (a crop zone)", async () => {
    await ensureStoreNavigation(CAMPAIGN_BASE);
    const rebuildSpy = vi.spyOn(NavMeshService.prototype, "rebuild");
    // Exactly what tomato-2/tomato-3/apple-1/corn-1/orange-1 push onto
    // unlockedAreas: a "farm-*" zone name `fixtureAvailable` never reads.
    expect(await ensureStoreNavigation([...CAMPAIGN_BASE, "farm-tomato-2"])).toBe(true);
    expect(rebuildSpy).not.toHaveBeenCalled();
    rebuildSpy.mockRestore();
  });

  it("rebuilds when a real navigable area/obstacle actually appears", async () => {
    await ensureStoreNavigation(CAMPAIGN_BASE);
    const rebuildSpy = vi.spyOn(NavMeshService.prototype, "rebuild");
    // Unlocking the expansion changes the walkable floor for real.
    expect(await ensureStoreNavigation([...CAMPAIGN_BASE, "expansion-side"])).toBe(true);
    expect(rebuildSpy).toHaveBeenCalledTimes(1);
    // A second checkout counter is a brand new obstacle.
    expect(await ensureStoreNavigation([...CAMPAIGN_BASE, "expansion-side", "checkout-2"])).toBe(true);
    expect(rebuildSpy).toHaveBeenCalledTimes(2);
    // The flour mill's zone gates the production-cubicle walls.
    expect(await ensureStoreNavigation([...CAMPAIGN_BASE, "expansion-side", "checkout-2", "flour-mill"])).toBe(true);
    expect(rebuildSpy).toHaveBeenCalledTimes(3);
    rebuildSpy.mockRestore();
  });

  it("coalesces several rapid invalidations: 11 is never built, only 10 (already running, can't cancel) and 12 (the final state) are", async () => {
    const base = ["purchase-campaign"];
    await ensureStoreNavigation(base);
    const rebuildSpy = vi.spyOn(NavMeshService.prototype, "rebuild");
    // Fire generation 10 -> 11 -> 12 back to back, before any of them can
    // settle. 10 is already running by the time 11/12 arrive and cannot be
    // cancelled, so it still pays for one real build — but its result is
    // discarded once it turns out to be stale, and the library is never
    // asked to build 11 at all: only the final state, 12, gets a fresh build.
    const p10 = ensureStoreNavigation([...base, "expansion-side"]);
    const p11 = ensureStoreNavigation([...base, "expansion-side", "checkout-2"]);
    const p12 = ensureStoreNavigation([...base, "expansion-side", "checkout-2", "flour-mill"]);
    const [r10, r11, r12] = await Promise.all([p10, p11, p12]);
    expect(r12).toBe(true);
    expect(r10).toBe(false);
    expect(r11).toBe(false);
    expect(rebuildSpy).toHaveBeenCalledTimes(2);
    rebuildSpy.mockRestore();
  });

  it("a real exception (not a `false` return) resolves the build instead of hanging the pipeline forever", async () => {
    const base = ["purchase-campaign", "throw-probe"];
    await ensureStoreNavigation(base);
    expect(isStoreNavigationReady()).toBe(true);
    const pathBefore = storePathfinder([0, 6.25], [0, 0]);

    const rebuildSpy = vi.spyOn(NavMeshService.prototype, "rebuild").mockImplementationOnce(() => {
      throw new Error("simulated Recast crash, not a `success: false`");
    });
    try {
      // Must resolve `false`, not hang and not throw out of `ensureStoreNavigation` itself.
      await expect(ensureStoreNavigation([...base, "expansion-side"])).resolves.toBe(false);
    } finally {
      rebuildSpy.mockRestore();
    }
    // The previous, still-valid navmesh is untouched by the crash.
    expect(isStoreNavigationReady()).toBe(true);
    expect(storePathfinder([0, 6.25], [0, 0])).toEqual(pathBefore);

    // The pipeline is not jammed: a later, real invalidation still builds and applies.
    await expect(ensureStoreNavigation([...base, "expansion-side"])).resolves.toBe(true);
  });
});

/**
 * A worker Worker only ever exists in a browser (`typeof Worker` is always
 * `undefined` in this project's plain-Node test environment, which is why
 * every test above exercises `buildOnCurrentThread`). These two tests stand
 * up a minimal fake `Worker` for exactly one request each, to exercise the
 * worker-specific paths in `NavMeshService.ts` that nothing else here can
 * reach: reuse and error recovery.
 */
describe("navmesh worker: reused across builds, errors never lose the last valid navmesh", () => {
  async function realExportedBuffer(areas: readonly string[]): Promise<ArrayBuffer> {
    await init();
    const geometry = createWalkableStoreGeometry(areas);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const result = threeToSoloNavMesh([mesh], { cs: 0.18, ch: 0.1, walkableRadius: 2, walkableHeight: 18, walkableClimb: 2 });
    geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();
    if (!result.success) throw new Error("test setup: could not build a real navmesh to fake a worker reply with");
    const bytes = exportNavMesh(result.navMesh).slice();
    result.navMesh.destroy();
    return bytes.buffer;
  }

  class FakeWorker {
    static instances: FakeWorker[] = [];
    onerror: ((event: { message: string }) => void) | null = null;
    private listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};
    /** The exact request `ensureStoreNavigation` posted, captured for the test to reply to. */
    lastRequest: { generation: number; areas: string[] } | null = null;
    constructor() { FakeWorker.instances.push(this); }
    addEventListener(type: string, handler: (event: { data: unknown }) => void) { (this.listeners[type] ??= []).push(handler); }
    removeEventListener(type: string, handler: (event: { data: unknown }) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter((entry) => entry !== handler); }
    postMessage(request: { generation: number; areas: string[] }) { this.lastRequest = request; }
    emitMessage(data: unknown) { for (const handler of this.listeners.message ?? []) handler({ data }); }
  }

  it("reuses the same worker instance across successive builds instead of recreating it", async () => {
    const originalWorker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = FakeWorker as unknown as typeof Worker;
    FakeWorker.instances.length = 0;
    let worker: FakeWorker | undefined;
    try {
      // Real, distinct gated areas (not a dummy "unique probe" name, which
      // `walkableSignature` would ignore entirely and could collide with
      // another test's final state): "checkout-2" and "cow-station" are not
      // used as the final state by any other test in this file.
      const base = ["purchase-campaign"];

      // First build: `ensureStoreNavigation` posts synchronously, so the
      // worker and its request already exist before we need to reply.
      const areas1 = [...base, "checkout-2"];
      const first = ensureStoreNavigation(areas1);
      expect(FakeWorker.instances).toHaveLength(1);
      worker = FakeWorker.instances[0];
      const request1 = worker.lastRequest!;
      const buffer1 = await realExportedBuffer(areas1);
      worker.emitMessage({ generation: request1.generation, success: true, buffer: buffer1, workerBuildMs: 1 });
      expect(await first).toBe(true);

      // Second, different, legitimate build: must reuse the same instance.
      const areas2 = [...areas1, "cow-station"];
      const second = ensureStoreNavigation(areas2);
      expect(FakeWorker.instances).toHaveLength(1);
      const request2 = worker.lastRequest!;
      expect(request2.generation).not.toBe(request1.generation);
      const buffer2 = await realExportedBuffer(areas2);
      worker.emitMessage({ generation: request2.generation, success: true, buffer: buffer2, workerBuildMs: 1 });
      expect(await second).toBe(true);
    } finally {
      // `getNavWorker()`'s cache is module-level state, not test-level: force
      // it back to null (through the same error path production uses) so the
      // next test that installs a `Worker` global starts from a clean slate
      // instead of silently reusing this test's worker instance.
      worker?.onerror?.({ message: "test cleanup" });
      (globalThis as { Worker?: unknown }).Worker = originalWorker;
    }
  });

  it("a worker error keeps the last valid navmesh, reports failure, and a fresh worker serves the next request", async () => {
    // Real, distinct gated area, not a no-op probe name: "cheese-maker" is
    // not the final state of any other test in this file.
    const base = ["purchase-campaign"];
    // Establish a real, valid baseline through the plain Node fallback (no Worker global yet).
    await ensureStoreNavigation(base);
    expect(isStoreNavigationReady()).toBe(true);
    const pathBefore = storePathfinder([0, 6.25], [0, 0]);

    const originalWorker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = FakeWorker as unknown as typeof Worker;
    FakeWorker.instances.length = 0;
    try {
      const areasA = [...base, "cheese-maker"];
      const failing = ensureStoreNavigation(areasA);
      expect(FakeWorker.instances).toHaveLength(1);
      const deadWorker = FakeWorker.instances[0];
      deadWorker.onerror?.({ message: "simulated worker crash" });
      expect(await failing).toBe(false);
      // The previous, still-valid navmesh answers exactly as before — a
      // failed rebuild must never clear readiness or the old result.
      expect(isStoreNavigationReady()).toBe(true);
      expect(storePathfinder([0, 6.25], [0, 0])).toEqual(pathBefore);

      // The dead worker is not reused for the next request.
      const recovered = ensureStoreNavigation(areasA);
      expect(FakeWorker.instances).toHaveLength(2);
      const freshWorker = FakeWorker.instances[1];
      expect(freshWorker).not.toBe(deadWorker);
      const request = freshWorker.lastRequest!;
      const buffer = await realExportedBuffer(areasA);
      freshWorker.emitMessage({ generation: request.generation, success: true, buffer, workerBuildMs: 1 });
      expect(await recovered).toBe(true);
      expect(isStoreNavigationReady()).toBe(true);
    } finally {
      // Same reasoning as the reuse test's cleanup: leave no worker cached.
      FakeWorker.instances.at(-1)?.onerror?.({ message: "test cleanup" });
      (globalThis as { Worker?: unknown }).Worker = originalWorker;
    }
  });
});
