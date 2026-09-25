import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/**
 * Asset loading for the plain-three client. Every model the level draws is
 * a budget GLB (`public/models/market/budget/...`) fetched once, decoded with
 * meshopt and kept in a cache; nothing loads after the level is ready.
 */
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();

export function loadGltf(path: string): Promise<GLTF> {
  let pending = cache.get(path);
  if (!pending) {
    pending = loader.loadAsync(path);
    cache.set(path, pending);
    pending.catch(() => cache.delete(path));
  }
  return pending;
}

export const BUDGET_ROOT = "/models/market/budget";

export function budgetPath(family: "characters" | "customers" | "hats" | "hair" | "delivered" | "environment", file: string, body?: string) {
  return body ? `${BUDGET_ROOT}/${family}/${body}/${file}.glb` : `${BUDGET_ROOT}/${family}/${file}.glb`;
}

export interface WorldAnchor {
  kind: "machine" | "text" | "retail-stock" | "retail-stock-screen" | "crop" | "dynamic" | "checkout" | "magnet";
  name: string;
  group?: string;
  matrix: number[];
  text?: string;
  fontSize?: number;
  color?: string | number;
  anchorX?: string;
  anchorY?: string;
  fontWeight?: string | number;
  /** Dynamic group a label was found in (stock screen, machine status), if any. */
  within?: string | null;
}

export interface BakedWorld {
  /** The merged static store, already in world units. */
  root: THREE.Group;
  anchors: WorldAnchor[];
  triangles: number;
  meshes: number;
}

/** Loads the baked static store of a level plus its dynamic anchors. */
export async function loadBakedWorld(name: string): Promise<BakedWorld> {
  const [gltf, anchorsResponse] = await Promise.all([
    loadGltf(`${BUDGET_ROOT}/world/${name}.glb`),
    fetch(`${BUDGET_ROOT}/world/${name}.anchors.json`),
  ]);
  if (!anchorsResponse.ok) throw new Error(`world anchors ${name}: ${anchorsResponse.status}`);
  const anchors = (await anchorsResponse.json()) as WorldAnchor[];
  const root = gltf.scene;
  let triangles = 0;
  let meshes = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    const geometry = object.geometry as THREE.BufferGeometry;
    triangles += Math.floor((geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3);
    // Baked pieces never move: a fixed world matrix and a tight bounding
    // sphere let three cull each cell against the camera every frame.
    object.matrixAutoUpdate = false;
    object.updateMatrix();
    object.frustumCulled = true;
    object.castShadow = false;
    object.receiveShadow = false;
    geometry.computeBoundingSphere();
    const material = object.material as THREE.MeshStandardMaterial;
    if (material.emissive && material.emissiveIntensity > 0 && material.emissive.getHex() !== 0 && material.color.getHex() === 0) {
      // Unlit sign faces were baked as emissive black-base materials.
      material.toneMapped = false;
    }
  });
  root.matrixAutoUpdate = false;
  root.updateMatrix();
  return { root, anchors, triangles, meshes };
}

/** Deep-clones a loaded model for placement (geometry and textures shared). */
export function instantiate(gltf: GLTF) {
  return gltf.scene.clone(true);
}
