import * as THREE from "three";
import masks from "./avatar-hair-masks.json";

const cache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** Remove only authored hair faces; retain original skin, morphs and UVs. */
export function maskedHairGeometry(original: THREE.BufferGeometry, modelPath: string): THREE.BufferGeometry {
  const key = modelPath.replace("/models/market/", "") as keyof typeof masks;
  const mask = masks[key];
  const index = original.getIndex();
  // Refuse stale masks after an asset replacement instead of damaging its face.
  if (!mask || !index || index.count !== mask.triangles * 3) return original;
  const previous = cache.get(original);
  if (previous) return previous;
  const removed = new Uint8Array(mask.triangles);
  for (const [start, count] of mask.runs) removed.fill(1, start, start + count);
  const kept: number[] = [];
  for (let triangle = 0; triangle < mask.triangles; triangle++) {
    if (!removed[triangle]) for (let k = 0; k < 3; k++) kept.push(index.getX(triangle * 3 + k));
  }
  const geometry = original.clone();
  geometry.setIndex(kept);
  geometry.clearGroups();
  cache.set(original, geometry);
  return geometry;
}
