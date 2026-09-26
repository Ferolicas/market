import * as THREE from "three";
import { PRODUCTION_CUBICLE } from "@/game/stations/production-layout";
import { STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE } from "@/game/world-scale";
import { makeBox, makeText, type Position } from "../primitives";
import { makeStoreElement } from "../storeElement";

/**
 * Faithful port of `ProductionBakeryCubicle` + `GlassPartition` from
 * MarketKit.tsx (lines ~818-859). Fully static shell: floor, five glass
 * partition walls and the front sign/threshold. Nothing inside reads
 * `ProductionMachineState` or any other live prop, so this file exposes a
 * single builder and no `update()` — matching the source, which never
 * re-renders these pieces on machine state changes (only the machine
 * fixtures themselves, built in `machines.ts`, carry `dynamic:` groups).
 */

const PRODUCTION_LAYOUT_TO_LOCAL = STORE_LAYOUT_SCALE / STORE_ELEMENT_SCALE;

function buildGlassPartition(width: number, depth: number): THREE.Group {
  const group = new THREE.Group();
  const alongX = width >= depth;
  const postPositions: Position[] = alongX
    ? [[-width / 2, 1.2, 0], [width / 2, 1.2, 0]]
    : [[0, 1.2, -depth / 2], [0, 1.2, depth / 2]];

  const glassGeometry = new THREE.BoxGeometry(width, 2.28, depth);
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: "#bde5df", transparent: true, opacity: 0.24, roughness: 0.08, metalness: 0.05, depthWrite: false, side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(glassGeometry, glassMaterial);
  glass.position.set(0, 1.2, 0);
  glass.receiveShadow = true;
  group.add(glass);

  for (const position of postPositions) group.add(makeBox({ args: [0.07, 2.48, 0.07], position, color: "#263c37", radius: 0.012 }));

  group.add(makeBox({
    args: [alongX ? width + 0.05 : 0.075, 0.075, alongX ? 0.075 : depth + 0.05],
    position: [0, 2.43, 0], color: "#263c37", radius: 0.012,
  }));
  group.add(makeBox({
    args: [alongX ? width : 0.045, 0.15, alongX ? 0.045 : depth],
    position: [0, 1.08, 0], color: "#d5eee8", radius: 0.006,
  }));
  group.add(makeBox({
    args: [alongX ? width + 0.04 : 0.09, 0.12, alongX ? 0.09 : depth + 0.04],
    position: [0, 0.08, 0], color: "#52645f", radius: 0.012,
  }));
  return group;
}

export function buildProductionCubicle(): THREE.Group {
  const { bounds, center, walls } = PRODUCTION_CUBICLE;
  const floorWidth = (bounds.right - bounds.left) * PRODUCTION_LAYOUT_TO_LOCAL;
  const floorDepth = (bounds.front - bounds.rear) * PRODUCTION_LAYOUT_TO_LOCAL;

  const root = new THREE.Group();
  root.name = "production:professional-bakery";

  const floorElement = makeStoreElement([center[0], 0, center[1]]);
  floorElement.add(makeBox({ args: [floorWidth, 0.055, floorDepth], position: [0, 0.025, 0], color: "#e7e1d3", radius: 0.018 }));
  for (let index = 0; index < 7; index += 1) {
    floorElement.add(makeBox({ args: [0.016, 0.009, floorDepth - 0.08], position: [(index - 3) * floorWidth / 7, 0.059, 0], color: "#c9c7bf", radius: 0.002 }));
  }
  for (let index = 0; index < 8; index += 1) {
    floorElement.add(makeBox({ args: [floorWidth - 0.08, 0.009, 0.016], position: [0, 0.059, (index - 3.5) * floorDepth / 8], color: "#c9c7bf", radius: 0.002 }));
  }
  root.add(floorElement);

  for (const wall of walls) {
    const wallElement = makeStoreElement([...wall.position] as Position);
    wallElement.add(buildGlassPartition(wall.halfX * 2 * PRODUCTION_LAYOUT_TO_LOCAL, wall.halfZ * 2 * PRODUCTION_LAYOUT_TO_LOCAL));
    root.add(wallElement);
  }

  const frontElement = makeStoreElement([center[0], 0, bounds.front]);
  frontElement.add(makeBox({ args: [2.05, 0.43, 0.14], position: [0, 2.32, 0], color: "#233a34", radius: 0.055 }));
  frontElement.add(makeText({ text: "PANADERÍA · OBRADOR", position: [0, 2.35, 0.081], fontSize: 0.165, color: "#fff3d2", anchorX: "center", anchorY: "middle", fontWeight: 900 }));
  const backLabel = makeText({ text: "PANADERÍA · OBRADOR", position: [0, 2.35, -0.081], fontSize: 0.165, color: "#fff3d2", anchorX: "center", anchorY: "middle", fontWeight: 900 });
  backLabel.rotation.set(0, Math.PI, 0);
  frontElement.add(backLabel);
  // Floor top is 0.0525. Keep the entire threshold above it: coincident top
  // faces caused depth flicker even while the simulation was idle.
  const threshold = new THREE.Group();
  threshold.name = "bakery-entrance-threshold";
  threshold.add(makeBox({ args: [1.85, 0.035, 0.5], position: [0, 0.082, 0], color: "#3d514b", radius: 0.008 }));
  frontElement.add(threshold);
  root.add(frontElement);

  return root;
}
