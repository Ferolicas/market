import { importNavMesh, init, NavMeshQuery, type NavMesh, type Vector3 } from "recast-navigation";
import { threeToSoloNavMesh } from "@recast-navigation/three";
import { Mesh, MeshBasicMaterial } from "three";
import { STORE_OBSTACLES } from "../world-scale";
import { fixtureAvailable } from "../stations/fixture-availability";
import type { WorkerBuildRequest, WorkerBuildResult } from "./navmesh-worker-protocol";
import { createWalkableStoreGeometry } from "./walkable-geometry";

export { createWalkableStoreGeometry, isStoreNavigationPoint, STORE_NAVIGATION_BOUNDS } from "./walkable-geometry";

export class NavMeshService {
  private navMesh: NavMesh | null = null;
  private query: NavMeshQuery | null = null;
  private generation = -1;

  /**
   * Direct, synchronous build — used server-side (`ServerNavigation.ts`,
   * one Recast build per request in a Node process, no browser/Worker
   * context available and no 60 Hz loop to protect). The browser's own
   * `ensureStoreNavigation()` never calls this; it goes through the worker
   * and `applyImported()` below instead.
   */
  async rebuild(meshes: Mesh[], generation: number) {
    if (this.generation === generation && this.query) return true;
    await init();
    const result = threeToSoloNavMesh(meshes, { cs: 0.18, ch: 0.1, walkableRadius: 2, walkableHeight: 18, walkableClimb: 2 });
    if (!result.success) return false;
    this.dispose();
    this.navMesh = result.navMesh;
    this.query = new NavMeshQuery(result.navMesh, { maxNodes: 4096 });
    this.generation = generation;
    return true;
  }

  /**
   * Applies a navmesh built off-thread. `recast-navigation`'s WASM instance
   * is per-thread — the worker's own `init()` does not help the main thread,
   * which needs its own compiled module before `importNavMesh`/`NavMeshQuery`
   * work here. That is a real, separate, one-time cost; `onTiming` reports it
   * split from `navImportMs`/`navSwapMs` so it is never hidden inside them.
   * The swap itself is atomic: the previous navMesh/query stay live and
   * queryable right up until the moment they are replaced in these two
   * assignments, and the old ones are only disposed after the swap.
   */
  async applyImported(buffer: ArrayBuffer, generation: number, onTiming: (mainInitMs: number | null, navImportMs: number, navSwapMs: number) => void) {
    let mainInitMs: number | null = null;
    if (!mainWasmReady) {
      const initStart = performance.now();
      mainWasmReady = init();
      await mainWasmReady;
      mainInitMs = performance.now() - initStart;
    } else {
      await mainWasmReady;
    }
    const importStart = performance.now();
    const { navMesh } = importNavMesh(new Uint8Array(buffer));
    const navImportMs = performance.now() - importStart;

    const swapStart = performance.now();
    const query = new NavMeshQuery(navMesh, { maxNodes: 4096 });
    const previousNavMesh = this.navMesh;
    const previousQuery = this.query;
    this.navMesh = navMesh;
    this.query = query;
    this.generation = generation;
    previousQuery?.destroy();
    previousNavMesh?.destroy();
    const navSwapMs = performance.now() - swapStart;

    onTiming(mainInitMs, navImportMs, navSwapMs);
  }

  findPath(start: Vector3, end: Vector3): Vector3[] {
    if (!this.query) return [];
    const result = this.query.computePath(start, end, { halfExtents: { x: 1.5, y: 2, z: 1.5 }, maxPathPolys: 256, maxStraightPathPoints: 256 });
    return result.success ? result.path : [];
  }

  /** Slides a point from `start` towards `end` along the walkable surface,
   * stopping at (and gliding along) the navmesh edges: the kinematic
   * capsule the plain-three client moves the owner with. */
  moveAlongSurface(start: Vector3, end: Vector3): Vector3 | null {
    if (!this.query) return null;
    const nearest = this.query.findNearestPoly(start, { halfExtents: { x: 1, y: 2, z: 1 } });
    if (!nearest.success || !nearest.nearestRef) return null;
    const moved = this.query.moveAlongSurface(nearest.nearestRef, nearest.nearestPoint, end);
    return moved.success ? moved.resultPosition : null;
  }

  /** Nearest walkable point to `point`, or null off the mesh. */
  closestPoint(point: Vector3): Vector3 | null {
    if (!this.query) return null;
    const result = this.query.findClosestPoint(point, { halfExtents: { x: 2, y: 2, z: 2 } });
    return result.success ? result.point : null;
  }

  dispose() {
    this.query?.destroy();
    this.navMesh?.destroy();
    this.query = null;
    this.navMesh = null;
    this.generation = -1;
  }
}

const storeNavigation = new NavMeshService();
let storeNavigationReady = false;
let storeNavigationGeneration = -1;
let pendingBuild: Promise<boolean> | null = null;
let pendingGeneration = -1;
let requestedSignature = "";
let navigationGeneration = 0;
/** The main thread's own compiled WASM module — a separate instance from the
 * worker's (WASM instances are per-thread; nothing here is shared). */
let mainWasmReady: Promise<void> | null = null;

/**
 * The exact, minimal input `createWalkableStoreGeometry` reacts to: for each
 * static obstacle, only whether `fixtureAvailable` currently says it blocks
 * the floor (bounds and wall bands are fixed code, not state). Two `areas`
 * arrays that leave every obstacle's availability unchanged always produce
 * byte-identical geometry, no matter what else differs between them (an
 * unrelated area name, a bumped save counter, a stat-only purchase) — so
 * this, not a generic revision counter, is the navmesh's real cache key.
 * Confirmed by reading `createWalkableStoreGeometry` itself: `areas` is its
 * only variable input, always reached through `fixtureAvailable`. If a
 * future change makes the geometry react to anything else, this signature
 * must grow to cover it too, or it will silently go stale.
 */
function walkableSignature(areas: readonly string[]): string {
  let signature = "";
  for (const obstacle of STORE_OBSTACLES) signature += fixtureAvailable(obstacle.id, areas) ? "1" : "0";
  return signature;
}

// ─── Worker: persistent, created once, reused for the page's lifetime ──────

let navWorker: Worker | null = null;
/** Resolves/rejects the in-flight build's promise; only `worker.onerror` uses this. */
let activeBuildResolve: ((success: boolean) => void) | null = null;

function getNavWorker(): Worker {
  if (navWorker) return navWorker;
  const worker = new Worker(new URL("./navmesh.worker.ts", import.meta.url), { type: "module" });
  worker.onerror = (event) => {
    console.error("[NavMeshService] worker error, keeping the last valid navmesh:", event.message);
    // The last successfully applied navMesh/query are untouched — only the
    // in-flight build (if any) is reported as failed. A fresh worker replaces
    // this one so the next request is not stuck talking to a dead context.
    activeBuildResolve?.(false);
    activeBuildResolve = null;
    navWorker = null;
  };
  navWorker = worker;
  return worker;
}

/** Real, measured cost of the last build — read after `ensureStoreNavigation`
 * resolves. `workerInitMs`/`mainInitMs` are `null` until the one-time WASM
 * compile they each measure has actually happened. */
export const navBuildTelemetry = {
  workerInitMs: null as number | null,
  workerBuildMs: 0,
  transferMs: 0,
  mainInitMs: null as number | null,
  navImportMs: 0,
  navSwapMs: 0,
};

function buildInWorker(generation: number, areas: readonly string[]): Promise<boolean> {
  const worker = getNavWorker();
  const requestStart = performance.now();
  return new Promise<boolean>((resolve) => {
    activeBuildResolve = resolve;
    const handleMessage = (event: MessageEvent<WorkerBuildResult>) => {
      if (event.data.generation !== generation) return;
      worker.removeEventListener("message", handleMessage);
      activeBuildResolve = null;
      const receivedAt = performance.now();
      navBuildTelemetry.workerBuildMs = event.data.workerBuildMs;
      if (event.data.workerInitMs !== undefined) navBuildTelemetry.workerInitMs = event.data.workerInitMs;
      navBuildTelemetry.transferMs = Math.max(0, receivedAt - requestStart - event.data.workerBuildMs - (event.data.workerInitMs ?? 0));
      if (!event.data.success || !event.data.buffer) { resolve(false); return; }
      // Superseded while the worker was building: don't even pay for the
      // import — a newer request is already what the caller chain wants.
      if (generation !== navigationGeneration) { resolve(false); return; }
      storeNavigation.applyImported(event.data.buffer, generation, (mainInitMs, navImportMs, navSwapMs) => {
        navBuildTelemetry.mainInitMs = mainInitMs ?? navBuildTelemetry.mainInitMs;
        navBuildTelemetry.navImportMs = navImportMs;
        navBuildTelemetry.navSwapMs = navSwapMs;
      }).then(
        () => resolve(true),
        // A corrupt/invalid buffer (or a WASM init failure) throwing here must
        // still resolve — otherwise this promise hangs forever and every
        // later `ensureStoreNavigation()` call jams behind it for the rest of
        // the session, exactly like an uncaught worker exception would.
        (error: unknown) => {
          console.error("[NavMeshService] importing the worker's navmesh failed, keeping the previous one:", error);
          resolve(false);
        },
      );
    };
    worker.addEventListener("message", handleMessage);
    const request: WorkerBuildRequest = { generation, areas: [...areas] };
    worker.postMessage(request);
  });
}

/**
 * `Worker` does not exist in this codebase's test/SSR environment (plain
 * Node, no browser globals) — every real browser has had it for over a
 * decade, so this is not a workaround for the phase, it is the one runtime
 * that genuinely lacks it. There, build inline through the same `rebuild()`
 * server-side navigation already uses, on the calling thread — exactly the
 * pre-worker behaviour, so every existing navigation test keeps exercising
 * the real Recast pipeline unchanged.
 */
async function buildOnCurrentThread(generation: number, areas: readonly string[]): Promise<boolean> {
  const buildStart = performance.now();
  let geometry: ReturnType<typeof createWalkableStoreGeometry> | null = null;
  let mesh: Mesh | null = null;
  try {
    // A synchronous throw here (geometry generation, or the `rebuild()` call
    // itself) is just as fatal to the coalescing chain as an async rejection
    // would be — this whole function body, not just a `.then()`, needs to be
    // guarded so `buildNavMesh` never rejects either way.
    geometry = createWalkableStoreGeometry(areas);
    mesh = new Mesh(geometry, new MeshBasicMaterial());
    return await storeNavigation.rebuild([mesh], generation);
  } catch (error) {
    console.error("[NavMeshService] inline navmesh build threw, keeping the previous one:", error);
    return false;
  } finally {
    navBuildTelemetry.workerBuildMs = performance.now() - buildStart;
    navBuildTelemetry.transferMs = 0;
    navBuildTelemetry.navImportMs = 0;
    navBuildTelemetry.navSwapMs = 0;
    geometry?.dispose();
    (mesh?.material as MeshBasicMaterial | undefined)?.dispose();
  }
}

function buildNavMesh(generation: number, areas: readonly string[]): Promise<boolean> {
  return typeof Worker === "undefined" ? buildOnCurrentThread(generation, areas) : buildInWorker(generation, areas);
}

/**
 * Rebuilds only when the walkable geometry itself would actually change.
 * Callers may pass a franchise's own change counter or any other unrelated
 * state without triggering wasted Recast builds — only `areas` (through
 * `walkableSignature`) can invalidate the cache. Requesting a new generation
 * does not clear `storeNavigationReady`: whatever navmesh is currently
 * applied (an older generation, mid-rebuild) stays fully valid and queryable
 * for as long as the new one takes to build — first boot is the only time
 * there is genuinely nothing to fall back on.
 */
export function ensureStoreNavigation(areas: readonly string[] = []): Promise<boolean> {
  const signature = walkableSignature(areas);
  if (signature !== requestedSignature) {
    requestedSignature = signature;
    navigationGeneration += 1;
  }
  return ensureNavigationGeneration(navigationGeneration, [...areas]);
}

/**
 * Coalescing: only one build is ever in flight. If generation 10 is building
 * when 11 then 12 arrive, both just chain onto the same `pendingBuild`; once
 * 10 settles, whichever generation is still current (12) recurses into a
 * fresh build here — 11 is never built at all, and 10's result is discarded
 * the moment it turns out to be stale (`buildInWorker` checks this itself
 * before paying for the import).
 *
 * A failed or superseded build never clears `storeNavigationReady`/
 * `storeNavigationGeneration` — only a genuine successful import for the
 * *still-current* generation ever updates them. Whatever was last applied
 * (possibly an older generation, e.g. while this build was in flight or
 * after a worker error) keeps answering `storePathfinder`/`isStoreNavigationPoint`
 * exactly as before. `false` is never itself an error; it means "not this
 * generation", not "navigation just broke".
 */
function ensureNavigationGeneration(generation: number, areas: readonly string[]): Promise<boolean> {
  if (storeNavigationGeneration === generation) return Promise.resolve(true);
  if (pendingBuild && pendingGeneration === generation) return pendingBuild;
  if (pendingBuild) return pendingBuild.then(() => generation === navigationGeneration ? ensureNavigationGeneration(generation, areas) : false);
  pendingGeneration = generation;
  const settle = (success: boolean) => {
    const applied = success && generation === navigationGeneration;
    if (applied) {
      storeNavigationReady = true;
      storeNavigationGeneration = generation;
    }
    pendingBuild = null;
    pendingGeneration = -1;
    return applied;
  };
  // Both `buildInWorker` and `buildOnCurrentThread` already resolve `false`
  // instead of rejecting on any internal error — this `.catch` is a second,
  // defense-in-depth guard at the one chokepoint every caller coalesces
  // through: without it, a single future leaf that forgets to catch its own
  // errors would leave `pendingBuild` rejected forever, jamming every later
  // `ensureStoreNavigation()` call behind it for the rest of the session.
  pendingBuild = buildNavMesh(generation, areas).then(settle, (error: unknown) => {
    console.error("[NavMeshService] navmesh build rejected unexpectedly, keeping the previous one:", error);
    return settle(false);
  });
  return pendingBuild;
}

/** Whether `storePathfinder` would answer with real paths right now. The
 * command log records it per tick so a replay uses the same navigation. */
export function isStoreNavigationReady() {
  return storeNavigationReady;
}

export function storePathfinder(start: [number, number], end: [number, number]): [number, number][] {
  if (!storeNavigationReady) return [];
  const path = storeNavigation.findPath({ x: start[0], y: 0, z: start[1] }, { x: end[0], y: 0, z: end[1] });
  return path.map((point) => [point.x, point.z]);
}

/** Surface walk in layout units (same units as `storePathfinder`). */
export function storeMoveAlongSurface(start: readonly [number, number], end: readonly [number, number]): [number, number] | null {
  const moved = storeNavigation.moveAlongSurface({ x: start[0], y: 0, z: start[1] }, { x: end[0], y: 0, z: end[1] });
  return moved ? [moved.x, moved.z] : null;
}

export function storeClosestNavigationPoint(point: readonly [number, number]): [number, number] | null {
  const closest = storeNavigation.closestPoint({ x: point[0], y: 0, z: point[1] });
  return closest ? [closest.x, closest.z] : null;
}
