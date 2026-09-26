import { BufferGeometry, Float32BufferAttribute } from "three";
import { overlapsStoreObstacle, scaleStorePoint, STORE_LAYOUT_SCALE } from "../world-scale";
import { FARM_FIELD } from "../stations/farm-layout";
import { STORE_REAR_DOOR } from "../stations/storefront-layout";

/**
 * Pure walkable-geometry generation, kept apart from `NavMeshService.ts` so
 * `navmesh.worker.ts` can import it without also importing `NavMeshService.ts`
 * itself — that file is the one that spawns the worker via
 * `new Worker(new URL("./navmesh.worker.ts", ...))`, and a worker module
 * importing back from the file that references it turned into a real
 * circular chunk dependency that made Turbopack's build hang. No such cycle
 * exists through this file.
 */

const NAVIGATION_CELL_SIZE = 0.36;
const NAVMESH_FURNITURE_PADDING = 0.31 * STORE_LAYOUT_SCALE;

export const STORE_NAVIGATION_BOUNDS = {
  minX: -13,
  maxX: 13,
  minZ: FARM_FIELD.center[2] - FARM_FIELD.size[2] / 2 - 0.5,
  maxZ: 15.7,
} as const;

const STORE_WALL_BANDS = {
  front: { minZ: 7.55, maxZ: 8.08, maxAbsX: 11.55, doorHalfWidth: 1.82 },
  rear: {
    minZ: STORE_REAR_DOOR.wallCenterZ - STORE_REAR_DOOR.wallDepth / 2 - 0.01,
    maxZ: -8.2,
    maxAbsX: STORE_REAR_DOOR.wallHalfWidth + 0.05,
    doorMinX: STORE_REAR_DOOR.x - STORE_REAR_DOOR.door.outerPostOffset + STORE_REAR_DOOR.door.postWidth / 2,
    doorMaxX: STORE_REAR_DOOR.x + STORE_REAR_DOOR.door.outerPostOffset - STORE_REAR_DOOR.door.postWidth / 2,
  },
  side: { minAbsX: 11.13, maxAbsX: 11.58, minZ: -8.72, maxZ: 8.08 },
} as const;

/**
 * Pure walkability predicate shared by mesh generation and layout tests.
 * The rear service entrance is cut from the same authored layout used by the
 * visible wall and Rapier colliders, so navigation can never target a false
 * decorative opening.
 */
export function isStoreNavigationPoint(point: readonly [number, number], areas: readonly string[] = []) {
  const [x, z] = point;
  if (x < STORE_NAVIGATION_BOUNDS.minX || x > STORE_NAVIGATION_BOUNDS.maxX || z < STORE_NAVIGATION_BOUNDS.minZ || z > STORE_NAVIGATION_BOUNDS.maxZ) return false;
  if (overlapsStoreObstacle(scaleStorePoint([x, z]), NAVMESH_FURNITURE_PADDING, areas)) return false;

  const absX = Math.abs(x);
  const front = STORE_WALL_BANDS.front;
  if (z > front.minZ && z < front.maxZ && absX < front.maxAbsX && absX > front.doorHalfWidth) return false;
  const rear = STORE_WALL_BANDS.rear;
  const insideRearDoor = x > rear.doorMinX && x < rear.doorMaxX;
  if (z > rear.minZ && z < rear.maxZ && absX < rear.maxAbsX && !insideRearDoor) return false;
  const side = STORE_WALL_BANDS.side;
  if (absX > side.minAbsX && absX < side.maxAbsX && z > side.minZ && z < side.maxZ) return false;
  return true;
}

/** Geometry used by Recast (main-thread server build, or the worker) and by
 * the debug overlay, kept from one source. */
export function createWalkableStoreGeometry(areas: readonly string[] = []) {
  const cell = NAVIGATION_CELL_SIZE;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let z = STORE_NAVIGATION_BOUNDS.minZ; z < STORE_NAVIGATION_BOUNDS.maxZ; z += cell) {
    for (let x = STORE_NAVIGATION_BOUNDS.minX; x < STORE_NAVIGATION_BOUNDS.maxX; x += cell) {
      const center: [number, number] = [x + cell / 2, z + cell / 2];
      if (!isStoreNavigationPoint(center, areas)) continue;
      const base = positions.length / 3;
      positions.push(x, 0, z, x + cell, 0, z, x + cell, 0, z + cell, x, 0, z + cell);
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
