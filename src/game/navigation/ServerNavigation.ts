import { init } from "recast-navigation";
import { Mesh, MeshBasicMaterial } from "three";
import type { WorldPathfinder } from "../engine";
import type { GameState } from "../types";
import { NavMeshService, createWalkableStoreGeometry } from "./NavMeshService";

/**
 * Navigation for replays on the server: one Recast mesh per set of unlocked
 * areas, built from the same walkable grid the browser uses, kept in memory.
 * Measured in Node on 24-09-2026: 10–55 ms of geometry plus 12–19 ms of
 * Recast per signature, 21 KB each, so building on demand beats shipping
 * baked meshes.
 */
const MAXIMUM_CACHED_MESHES = 64;
const services = new Map<string, Promise<NavMeshService | null>>();
let wasmReady: Promise<void> | null = null;

function signatureOf(state: GameState) {
  const franchise = state.franchises.find((item) => item.id === state.currentFranchiseId) ?? state.franchises[0];
  return [...(franchise?.unlockedAreas ?? [])].sort().join("|");
}

async function serviceFor(signature: string) {
  const cached = services.get(signature);
  if (cached) return cached;
  const building = (async () => {
    wasmReady ??= init();
    await wasmReady;
    const service = new NavMeshService();
    const geometry = createWalkableStoreGeometry(signature ? signature.split("|") : []);
    const material = new MeshBasicMaterial();
    const success = await service.rebuild([new Mesh(geometry, material)], 0);
    geometry.dispose();
    material.dispose();
    return success ? service : null;
  })();
  services.set(signature, building);
  if (services.size > MAXIMUM_CACHED_MESHES) {
    const oldest = services.keys().next().value;
    if (oldest !== undefined) {
      void services.get(oldest)?.then((service) => service?.dispose());
      services.delete(oldest);
    }
  }
  return building;
}

/** Pathfinder for the store the state is visiting, or `undefined` when the
 * mesh could not be built (the engine then falls back to its lanes). */
export async function serverPathfinderFor(state: GameState): Promise<WorldPathfinder | undefined> {
  const service = await serviceFor(signatureOf(state));
  if (!service) return undefined;
  return (start, end) => service.findPath({ x: start[0], y: 0, z: start[1] }, { x: end[0], y: 0, z: end[1] }).map((point) => [point.x, point.z] as [number, number]);
}
