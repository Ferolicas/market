import { init, NavMeshQuery, type NavMesh, type Vector3 } from "recast-navigation";
import { threeToSoloNavMesh } from "@recast-navigation/three";
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from "three";
import { overlapsStoreObstacle, scaleStorePoint, STORE_LAYOUT_SCALE } from "../world-scale";
import { FARM_FIELD } from "../stations/farm-layout";
import { STORE_REAR_DOOR } from "../stations/storefront-layout";

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

export class NavMeshService {
  private navMesh: NavMesh | null = null;
  private query: NavMeshQuery | null = null;
  private revision = -1;

  async rebuild(meshes: Mesh[], structureRevision: number) {
    if (this.revision === structureRevision && this.query) return true;
    await init();
    const result = threeToSoloNavMesh(meshes, { cs: 0.18, ch: 0.1, walkableRadius: 2, walkableHeight: 18, walkableClimb: 2 });
    if (!result.success) return false;
    this.dispose();
    this.navMesh = result.navMesh;
    this.query = new NavMeshQuery(result.navMesh, { maxNodes: 4096 });
    this.revision = structureRevision;
    return true;
  }

  findPath(start: Vector3, end: Vector3): Vector3[] {
    if (!this.query) return [];
    const result = this.query.computePath(start, end, { halfExtents: { x: 1.5, y: 2, z: 1.5 }, maxPathPolys: 256, maxStraightPathPoints: 256 });
    return result.success ? result.path : [];
  }

  dispose() {
    this.query?.destroy();
    this.navMesh?.destroy();
    this.query = null;
    this.navMesh = null;
    this.revision = -1;
  }
}

const storeNavigation = new NavMeshService();
let storeNavigationReady = false;
let storeNavigationRevision = -1;
let pendingBuild: Promise<boolean> | null = null;
let pendingRevision = -1;

export function ensureStoreNavigation(structureRevision: number): Promise<boolean> {
  if (storeNavigationReady && storeNavigationRevision === structureRevision) return Promise.resolve(true);
  if (pendingBuild && pendingRevision === structureRevision) return pendingBuild;
  if (pendingBuild) return pendingBuild.then(() => ensureStoreNavigation(structureRevision));
  const mesh = createWalkableStoreMesh();
  pendingRevision = structureRevision;
  pendingBuild = storeNavigation.rebuild([mesh], structureRevision).then((success) => {
    storeNavigationReady = success;
    if (success) storeNavigationRevision = structureRevision;
    mesh.geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();
    pendingBuild = null;
    pendingRevision = -1;
    return success;
  });
  return pendingBuild;
}

export function storePathfinder(start: [number, number], end: [number, number]): [number, number][] {
  if (!storeNavigationReady) return [];
  const path = storeNavigation.findPath({ x: start[0], y: 0, z: start[1] }, { x: end[0], y: 0, z: end[1] });
  return path.map((point) => [point.x, point.z]);
}

function createWalkableStoreMesh() {
  return new Mesh(createWalkableStoreGeometry(), new MeshBasicMaterial());
}

/**
 * Pure walkability predicate shared by mesh generation and layout tests.
 * The rear service entrance is cut from the same authored layout used by the
 * visible wall and Rapier colliders, so navigation can never target a false
 * decorative opening.
 */
export function isStoreNavigationPoint(point: readonly [number, number]) {
  const [x, z] = point;
  if (x < STORE_NAVIGATION_BOUNDS.minX || x > STORE_NAVIGATION_BOUNDS.maxX || z < STORE_NAVIGATION_BOUNDS.minZ || z > STORE_NAVIGATION_BOUNDS.maxZ) return false;
  if (overlapsStoreObstacle(scaleStorePoint([x, z]), NAVMESH_FURNITURE_PADDING)) return false;

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

/** Geometry used by Recast and by the debug overlay, kept from one source. */
export function createWalkableStoreGeometry() {
  const cell = NAVIGATION_CELL_SIZE;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let z = STORE_NAVIGATION_BOUNDS.minZ; z < STORE_NAVIGATION_BOUNDS.maxZ; z += cell) {
    for (let x = STORE_NAVIGATION_BOUNDS.minX; x < STORE_NAVIGATION_BOUNDS.maxX; x += cell) {
      const center: [number, number] = [x + cell / 2, z + cell / 2];
      if (!isStoreNavigationPoint(center)) continue;
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
