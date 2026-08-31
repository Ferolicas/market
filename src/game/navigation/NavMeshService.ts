import { init, NavMeshQuery, type NavMesh, type Vector3 } from "recast-navigation";
import { threeToSoloNavMesh } from "@recast-navigation/three";
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from "three";
import { overlapsStoreObstacle, scaleStorePoint, STORE_LAYOUT_SCALE } from "../world-scale";

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

/** Geometry used by Recast and by the debug overlay, kept from one source. */
export function createWalkableStoreGeometry() {
  const cell = 0.36;
  const minX = -10.8;
  const maxX = 10.8;
  const minZ = -8;
  const maxZ = 15.6;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let z = minZ; z < maxZ; z += cell) {
    for (let x = minX; x < maxX; x += cell) {
      const center: [number, number] = [x + cell / 2, z + cell / 2];
      const scaled = scaleStorePoint(center);
      if (overlapsStoreObstacle(scaled, 0.31 * STORE_LAYOUT_SCALE)) continue;
      if (z > 7.55 && z < 8.2 && Math.abs(x) > 1.82) continue;
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
