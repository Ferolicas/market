import * as THREE from "three";
import { makeBox } from "../primitives";

/** Faithful, fully static port of `CashierWorkArea` from `MarketKit.tsx`. */
export function buildCashierWorkArea(): THREE.Group {
  const group = new THREE.Group();
  group.add(makeBox({ args: [1.34, 0.045, 0.9], position: [0, 0.022, 0], color: "#293532", radius: 0.12 }));
  const geometry = new THREE.BoxGeometry(0.035, 0.012, 0.68);
  const material = new THREE.MeshStandardMaterial({ color: "#4a5b56", roughness: 0.9 });
  for (const x of [-0.42, -0.21, 0, 0.21, 0.42]) {
    const mark = new THREE.Mesh(geometry, material);
    mark.position.set(x, 0.049, 0);
    group.add(mark);
  }
  return group;
}
