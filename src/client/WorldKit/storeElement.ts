import * as THREE from "three";
import { scaleStorePosition, STORE_ELEMENT_SCALE } from "@/game/world-scale";
import type { Position } from "./primitives";

/**
 * Imperative port of `StoreElement` from MarketKit.tsx: every fixture group
 * is positioned via `scaleStorePosition` and uniformly scaled by
 * `STORE_ELEMENT_SCALE` — identical to the source, same constants from
 * `world-scale.ts` `ClientRuntime`'s `layoutRoot` (WORLD_SCALE) already uses.
 */
export function makeStoreElement(position: Position, yaw = 0): THREE.Group {
  const group = new THREE.Group();
  const scaled = scaleStorePosition(position);
  group.position.set(scaled[0], scaled[1], scaled[2]);
  group.rotation.y = THREE.MathUtils.degToRad(yaw);
  group.scale.setScalar(STORE_ELEMENT_SCALE);
  return group;
}
