import { exportNavMesh, init } from "recast-navigation";
import { threeToSoloNavMesh } from "@recast-navigation/three";
import { Mesh, MeshBasicMaterial } from "three";
import { createWalkableStoreGeometry } from "./walkable-geometry";
import type { WorkerBuildRequest, WorkerBuildResult } from "./navmesh-worker-protocol";

/**
 * Off-main-thread Recast build. Geometry generation, `threeToSoloNavMesh` and
 * `exportNavMesh` all run here — none of it touches the DOM, so it is safe on
 * a worker thread. `init()` compiles the recast-navigation WASM module once
 * per worker lifetime (its own internal `Raw.Module !== undefined` guard
 * makes every later call an instant no-op); this worker itself is created
 * once and reused by `NavMeshService.ts` for the page's whole lifetime, so
 * WASM compiles exactly once here, ever.
 */
let initPromise: Promise<void> | null = null;

/**
 * Every path out of here posts exactly one `WorkerBuildResult`, success or
 * failure — never nothing. A real exception (not the already-handled
 * `result.success === false`) inside an `async` `onmessage` handler rejects
 * silently on most engines: it does not reach `self.onerror`/the main
 * thread's `Worker.onerror`, so without this try/catch the main thread's
 * `pendingBuild` would wait forever and every future rebuild would jam
 * behind it for the rest of the session.
 */
self.onmessage = async (event: MessageEvent<WorkerBuildRequest>) => {
  const { generation, areas } = event.data;
  let workerInitMs: number | undefined;
  try {
    if (!initPromise) {
      const initStart = performance.now();
      initPromise = init();
      await initPromise;
      workerInitMs = performance.now() - initStart;
    } else {
      await initPromise;
    }

    const buildStart = performance.now();
    const geometry = createWalkableStoreGeometry(areas);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const result = threeToSoloNavMesh([mesh], { cs: 0.18, ch: 0.1, walkableRadius: 2, walkableHeight: 18, walkableClimb: 2 });
    geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();

    if (!result.success) {
      const workerBuildMs = performance.now() - buildStart;
      const failure: WorkerBuildResult = { generation, success: false, workerBuildMs, workerInitMs };
      (self as unknown as Worker).postMessage(failure);
      return;
    }

    // A defensive copy: `exportNavMesh`'s Uint8Array may be a view over a
    // larger WASM-heap buffer, and transferring `.buffer` directly would hand
    // over more (or a misaligned slice of) memory than intended. `.slice()`
    // guarantees a tightly-sized, standalone ArrayBuffer safe to transfer.
    const exported = exportNavMesh(result.navMesh).slice();
    result.navMesh.destroy();
    const workerBuildMs = performance.now() - buildStart;
    const success: WorkerBuildResult = { generation, success: true, buffer: exported.buffer, workerBuildMs, workerInitMs };
    (self as unknown as Worker).postMessage(success, [exported.buffer]);
  } catch (error) {
    console.error("[navmesh.worker] build threw, reporting failure instead of hanging the main thread:", error);
    const failure: WorkerBuildResult = { generation, success: false, workerBuildMs: 0, workerInitMs };
    (self as unknown as Worker).postMessage(failure);
  }
};
