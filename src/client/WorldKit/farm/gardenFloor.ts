import * as THREE from "three";
import { FARM_FIELD, FARM_GATE, farmGateOpenLeafTerminalPost } from "@/game/stations/farm-layout";
import { STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE } from "@/game/world-scale";
import { makeBox, makeInstances, type InstanceTransform, type Position } from "../primitives";
import { roundedBoxMesh } from "./farmShared";

/**
 * Faithful port of `GardenFloor` and `FarmEntranceGate` from `MarketKit.tsx`
 * (lines ~1209-1266). Every position/scale/color/radius below is copied
 * verbatim from the source; this is the farm's static ground shell, laid out
 * in the same "local" (unscaled by `StoreElement`) coordinate space the
 * source computes from `FARM_FIELD`/`FARM_GATE`.
 */

const FARM_LOCAL_LAYOUT_SCALE = STORE_LAYOUT_SCALE / STORE_ELEMENT_SCALE;
const FARM_LOCAL_HALF_WIDTH = FARM_FIELD.size[0] * FARM_LOCAL_LAYOUT_SCALE * 0.5;
const FARM_LOCAL_HALF_DEPTH = FARM_FIELD.size[2] * FARM_LOCAL_LAYOUT_SCALE * 0.5;
const FARM_RIGHT_FENCE_LOCAL_Z = (FARM_GATE.rightFence.center[2] - FARM_FIELD.center[2]) * FARM_LOCAL_LAYOUT_SCALE;
const FARM_FRONT_FENCE_LOCAL_X = (FARM_GATE.leftFrontFence.center[0] - FARM_FIELD.center[0]) * FARM_LOCAL_LAYOUT_SCALE;
const FARM_FRONT_FENCE_LOCAL_Z = (FARM_GATE.leftFrontFence.center[2] - FARM_FIELD.center[2]) * FARM_LOCAL_LAYOUT_SCALE;
const FARM_FRONT_FENCE_MIN_X = FARM_GATE.leftFrontFence.center[0] - FARM_GATE.leftFrontFence.halfX * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE);
const FARM_FRONT_FENCE_MAX_X = FARM_GATE.leftFrontFence.center[0] + FARM_GATE.leftFrontFence.halfX * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE);
const FARM_RIGHT_FRONT_FENCE_LOCAL_X = (FARM_GATE.rightFrontFence.center[0] - FARM_FIELD.center[0]) * FARM_LOCAL_LAYOUT_SCALE;
const FARM_WALL_CONNECTING_FENCES = [
  ...FARM_GATE.accessCorridorFences,
  ...FARM_GATE.perimeterWallFences,
].map((fence) => ({
  x: (fence.center[0] - FARM_FIELD.center[0]) * FARM_LOCAL_LAYOUT_SCALE,
  z: (fence.center[2] - FARM_FIELD.center[2]) * FARM_LOCAL_LAYOUT_SCALE,
  halfZ: fence.halfZ,
}));

const GARDEN_PATH_STONES: readonly InstanceTransform[] = [
  ...Array.from({ length: 35 }, (_, index): InstanceTransform => ({
    position: [12.25 - index * 0.43, 0.055, 3.28 + Math.sin(index * 0.72) * 0.08],
    rotation: [0, (index % 5 - 2) * 0.08, 0],
    scale: [0.9 + (index % 3) * 0.07, 1, 0.72 + (index % 2) * 0.08],
  })),
  ...Array.from({ length: 16 }, (_, index): InstanceTransform => ({
    position: [-2.15 + Math.sin(index * 1.1) * 0.045, 0.052, 3.05 - index * 0.43],
    rotation: [0, (index % 4 - 1.5) * 0.1, 0],
    scale: [0.78 + (index % 2) * 0.08, 1, 0.88],
  })),
];
const GARDEN_GRASS_TUFTS: readonly InstanceTransform[] = Array.from({ length: 52 }, (_, index): InstanceTransform => {
  const side = index % 2 ? 1 : -1;
  const lane = Math.floor(index / 2);
  return {
    position: [side * (5.25 + (lane % 7) * 0.72), 0.13, -3.7 + (lane % 13) * 0.58],
    rotation: [0, index * 0.73, (index % 3 - 1) * 0.08],
    scale: [0.7 + (index % 3) * 0.12, 0.75 + (index % 4) * 0.1, 0.7],
  };
});
const GARDEN_FLOWERS: readonly InstanceTransform[] = [
  [-11.9, -3.6], [-11.6, 3.35], [10.95, -3.65], [11.25, 2.9], [-8.8, 3.82], [7.8, -3.86],
].map(([x, z], index) => ({ position: [x, 0.26 + (index % 2) * 0.035, z], scale: [0.85, 0.85, 0.85] }));
const FARM_FENCE_POSTS: readonly InstanceTransform[] = [
  ...Array.from({ length: 15 }, (_, index): InstanceTransform => ({ position: [-FARM_LOCAL_HALF_WIDTH + index * (FARM_LOCAL_HALF_WIDTH * 2 / 14), 0.54, -FARM_LOCAL_HALF_DEPTH], scale: [0.1, 1.08, 0.1] })),
  ...Array.from({ length: 11 }, (_, index): InstanceTransform => ({
    position: [
      (FARM_FRONT_FENCE_MIN_X + index * ((FARM_FRONT_FENCE_MAX_X - FARM_FRONT_FENCE_MIN_X) / 10) - FARM_FIELD.center[0]) * FARM_LOCAL_LAYOUT_SCALE,
      0.54,
      FARM_FRONT_FENCE_LOCAL_Z,
    ],
    scale: [0.1, 1.08, 0.1],
  })),
  { position: [FARM_RIGHT_FRONT_FENCE_LOCAL_X, 0.54, FARM_FRONT_FENCE_LOCAL_Z], scale: [0.1, 1.08, 0.1] },
  ...Array.from({ length: 6 }, (_, index): InstanceTransform => ({ position: [-FARM_LOCAL_HALF_WIDTH, 0.54, -FARM_LOCAL_HALF_DEPTH + index * (FARM_LOCAL_HALF_DEPTH * 2 / 5)], scale: [0.1, 1.08, 0.1] })),
  ...Array.from({ length: 6 }, (_, index): InstanceTransform => ({ position: [FARM_LOCAL_HALF_WIDTH, 0.54, -FARM_LOCAL_HALF_DEPTH + index * (FARM_LOCAL_HALF_DEPTH * 2 / 5)], scale: [0.1, 1.08, 0.1] })),
  ...FARM_WALL_CONNECTING_FENCES.flatMap((fence): InstanceTransform[] => [
    { position: [fence.x, 0.54, fence.z], scale: [0.1, 1.08, 0.1] },
    { position: [fence.x, 0.54, fence.z + fence.halfZ], scale: [0.1, 1.08, 0.1] },
  ]),
];
const FARM_FENCE_RAILS: readonly InstanceTransform[] = [
  { position: [0, 0.38, -FARM_LOCAL_HALF_DEPTH], scale: [FARM_LOCAL_HALF_WIDTH * 2, 0.075, 0.075] },
  { position: [0, 0.72, -FARM_LOCAL_HALF_DEPTH], scale: [FARM_LOCAL_HALF_WIDTH * 2, 0.075, 0.075] },
  { position: [FARM_FRONT_FENCE_LOCAL_X, 0.38, FARM_FRONT_FENCE_LOCAL_Z], scale: [FARM_GATE.leftFrontFence.halfX * 2, 0.075, 0.075] },
  { position: [FARM_FRONT_FENCE_LOCAL_X, 0.72, FARM_FRONT_FENCE_LOCAL_Z], scale: [FARM_GATE.leftFrontFence.halfX * 2, 0.075, 0.075] },
  { position: [FARM_RIGHT_FRONT_FENCE_LOCAL_X, 0.38, FARM_FRONT_FENCE_LOCAL_Z], scale: [FARM_GATE.rightFrontFence.halfX * 2, 0.075, 0.075] },
  { position: [FARM_RIGHT_FRONT_FENCE_LOCAL_X, 0.72, FARM_FRONT_FENCE_LOCAL_Z], scale: [FARM_GATE.rightFrontFence.halfX * 2, 0.075, 0.075] },
  { position: [-FARM_LOCAL_HALF_WIDTH, 0.38, 0], scale: [0.075, 0.075, FARM_LOCAL_HALF_DEPTH * 2] },
  { position: [-FARM_LOCAL_HALF_WIDTH, 0.72, 0], scale: [0.075, 0.075, FARM_LOCAL_HALF_DEPTH * 2] },
  { position: [FARM_LOCAL_HALF_WIDTH, 0.38, FARM_RIGHT_FENCE_LOCAL_Z], scale: [0.075, 0.075, FARM_GATE.rightFence.halfZ * 2] },
  { position: [FARM_LOCAL_HALF_WIDTH, 0.72, FARM_RIGHT_FENCE_LOCAL_Z], scale: [0.075, 0.075, FARM_GATE.rightFence.halfZ * 2] },
  ...FARM_WALL_CONNECTING_FENCES.flatMap((fence): InstanceTransform[] => [
    { position: [fence.x, 0.38, fence.z], scale: [0.075, 0.075, fence.halfZ * 2] },
    { position: [fence.x, 0.72, fence.z], scale: [0.075, 0.075, fence.halfZ * 2] },
  ]),
];

function buildFarmEntranceGate(): THREE.Group {
  const frontPost: Position = [
    (FARM_GATE.frontPost[0] - FARM_FIELD.center[0]) * FARM_LOCAL_LAYOUT_SCALE,
    0,
    (FARM_GATE.frontPost[2] - FARM_FIELD.center[2]) * FARM_LOCAL_LAYOUT_SCALE,
  ];
  const innerPostOffsetX = (FARM_GATE.innerPost[0] - FARM_GATE.frontPost[0]) * FARM_LOCAL_LAYOUT_SCALE;
  const innerPostOffsetZ = (FARM_GATE.innerPost[2] - FARM_GATE.frontPost[2]) * FARM_LOCAL_LAYOUT_SCALE;
  const openLeafOffsetX = (FARM_GATE.openLeaf.center[0] - FARM_GATE.innerPost[0]) * FARM_LOCAL_LAYOUT_SCALE;
  const openLeafOffsetZ = (FARM_GATE.openLeaf.center[2] - FARM_GATE.innerPost[2]) * FARM_LOCAL_LAYOUT_SCALE;
  const openLeafTerminalPost = farmGateOpenLeafTerminalPost(STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE);
  const openLeafTerminalOffsetX = (openLeafTerminalPost[0] - FARM_GATE.innerPost[0]) * FARM_LOCAL_LAYOUT_SCALE;
  const openLeafTerminalOffsetZ = (openLeafTerminalPost[1] - FARM_GATE.innerPost[2]) * FARM_LOCAL_LAYOUT_SCALE;
  const openLeafDepth = FARM_GATE.openLeaf.halfZ * 2;

  const group = new THREE.Group();
  group.position.set(...frontPost);

  ([[0, 0], [innerPostOffsetX, innerPostOffsetZ]] as const).forEach(([x, z]) => {
    const post = new THREE.Group();
    post.position.set(x, 0, z);
    post.add(makeBox({ args: [0.19, 1.38, 0.19], position: [0, 0.69, 0], color: "#68472f", radius: 0.025 }));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 7), new THREE.MeshStandardMaterial({ color: "#d6b35e", roughness: 0.7 }));
    cap.position.set(0, 1.48, 0);
    post.add(cap);
    group.add(post);
  });

  // Park the open leaf behind the right post, flush with the east fence, so
  // the rear-door path is physically and visually unobstructed.
  const leaf = new THREE.Group();
  leaf.position.set(innerPostOffsetX, 0, innerPostOffsetZ);
  leaf.add(makeBox({ args: [0.09, 0.09, openLeafDepth], position: [openLeafOffsetX, 0.5, openLeafOffsetZ], color: "#b27a43" }));
  leaf.add(makeBox({ args: [0.09, 0.09, openLeafDepth], position: [openLeafOffsetX, 0.98, openLeafOffsetZ], color: "#b27a43" }));
  leaf.add(makeBox({
    args: [FARM_GATE.openLeaf.terminalPostDepth, 1.02, FARM_GATE.openLeaf.terminalPostDepth],
    position: [openLeafTerminalOffsetX, 0.74, openLeafTerminalOffsetZ],
    color: "#8c5b37",
  }));
  group.add(leaf);

  return group;
}

/** The farm's static ground shell: `GardenFloor` + `FarmEntranceGate`. */
export function buildGardenFloor(): THREE.Group {
  const group = new THREE.Group();

  const gardenShape = new THREE.Shape();
  gardenShape.moveTo(-FARM_LOCAL_HALF_WIDTH + 0.5, -FARM_LOCAL_HALF_DEPTH);
  gardenShape.quadraticCurveTo(-FARM_LOCAL_HALF_WIDTH, -FARM_LOCAL_HALF_DEPTH, -FARM_LOCAL_HALF_WIDTH, -FARM_LOCAL_HALF_DEPTH + 0.55);
  gardenShape.lineTo(-FARM_LOCAL_HALF_WIDTH, FARM_LOCAL_HALF_DEPTH - 0.42);
  gardenShape.quadraticCurveTo(-FARM_LOCAL_HALF_WIDTH, FARM_LOCAL_HALF_DEPTH, -FARM_LOCAL_HALF_WIDTH + 0.62, FARM_LOCAL_HALF_DEPTH);
  gardenShape.lineTo(FARM_LOCAL_HALF_WIDTH - 0.8, FARM_LOCAL_HALF_DEPTH);
  gardenShape.quadraticCurveTo(FARM_LOCAL_HALF_WIDTH, FARM_LOCAL_HALF_DEPTH, FARM_LOCAL_HALF_WIDTH, FARM_LOCAL_HALF_DEPTH - 0.74);
  gardenShape.lineTo(FARM_LOCAL_HALF_WIDTH, -FARM_LOCAL_HALF_DEPTH + 0.52);
  gardenShape.quadraticCurveTo(FARM_LOCAL_HALF_WIDTH, -FARM_LOCAL_HALF_DEPTH, FARM_LOCAL_HALF_WIDTH - 0.62, -FARM_LOCAL_HALF_DEPTH);
  gardenShape.closePath();

  const darkGround = new THREE.Mesh(new THREE.ShapeGeometry(gardenShape), new THREE.MeshStandardMaterial({ color: "#315d36", roughness: 1 }));
  darkGround.position.set(0, 0.006, 0);
  darkGround.rotation.set(-Math.PI / 2, 0, 0);
  darkGround.scale.set(1.035, 1.035, 1);
  darkGround.receiveShadow = true;
  group.add(darkGround);

  const lightGround = new THREE.Mesh(new THREE.ShapeGeometry(gardenShape), new THREE.MeshStandardMaterial({ color: "#59934f", roughness: 0.98 }));
  lightGround.position.set(0, 0.026, 0);
  lightGround.rotation.set(-Math.PI / 2, 0, 0);
  lightGround.receiveShadow = true;
  group.add(lightGround);

  group.add(roundedBoxMesh({ args: [10.6, 0.045, 0.78], position: [7.8, 0.055, 3.35], radius: 0.2, smoothness: 2, material: new THREE.MeshStandardMaterial({ color: "#b79a70", roughness: 1 }), receiveShadow: true }));
  group.add(roundedBoxMesh({ args: [14.7, 0.043, 0.74], position: [-4.35, 0.054, 3.35], radius: 0.18, smoothness: 2, material: new THREE.MeshStandardMaterial({ color: "#baa078", roughness: 1 }), receiveShadow: true }));
  group.add(roundedBoxMesh({ args: [0.82, 0.042, 7.15], position: [-2.15, 0.053, 0], radius: 0.18, smoothness: 2, material: new THREE.MeshStandardMaterial({ color: "#b79a70", roughness: 1 }), receiveShadow: true }));
  group.add(roundedBoxMesh({ args: [8.25, 0.038, 0.58], position: [-6.25, 0.052, -0.02], radius: 0.16, smoothness: 2, material: new THREE.MeshStandardMaterial({ color: "#a98e68", roughness: 1 }), receiveShadow: true }));

  group.add(makeInstances(GARDEN_PATH_STONES, new THREE.CylinderGeometry(0.23, 0.23, 0.04, 8), new THREE.MeshStandardMaterial({ color: "#a7a08c", roughness: 0.96 }), { receiveShadow: true }));
  group.add(makeInstances(GARDEN_GRASS_TUFTS, new THREE.ConeGeometry(0.065, 0.24, 5), new THREE.MeshStandardMaterial({ color: "#366f3b", roughness: 1 }), { castShadow: true }));
  group.add(makeInstances(GARDEN_FLOWERS, new THREE.DodecahedronGeometry(0.075, 0), new THREE.MeshStandardMaterial({ color: "#ffe395", emissive: "#9a6b2a", emissiveIntensity: 0.12, roughness: 0.82 }), { castShadow: true }));
  group.add(makeInstances(FARM_FENCE_POSTS, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#765035", roughness: 0.92 }), { castShadow: true, receiveShadow: true }));
  group.add(makeInstances(FARM_FENCE_RAILS, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#91633e", roughness: 0.9 }), { castShadow: true, receiveShadow: true }));

  group.add(buildFarmEntranceGate());
  return group;
}
