/** Message shapes between `NavMeshService.ts` (main thread) and `navmesh.worker.ts`. */

export interface WorkerBuildRequest {
  generation: number;
  areas: string[];
}

export interface WorkerBuildResult {
  generation: number;
  success: boolean;
  /** Present only when `success`; transferred, not copied. */
  buffer?: ArrayBuffer;
  /** Geometry + `threeToSoloNavMesh` + `exportNavMesh`, inside the worker. */
  workerBuildMs: number;
  /** Only set the one time this worker actually compiled the WASM module. */
  workerInitMs?: number;
}
