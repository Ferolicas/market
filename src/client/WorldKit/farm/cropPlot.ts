import * as THREE from "three";
import type { CropState } from "@/game/types";
import { cropVisualSlotIndices } from "@/game/stations/crop-visual";
import { applyInstanceTransforms, makeInstances, type InstanceTransform, type Position } from "../primitives";
import { buildStationSign, roundedBoxMesh } from "./farmShared";

/**
 * Faithful port of `farmCropKind`, `DormantCropPlot`, `CropPlot`,
 * `RaisedCropBed`, `SeedBed`, `CropCanopy` and `ReadyHarvestGlow` from
 * `MarketKit.tsx` (lines ~1190-1387). Every geometry arg, color and
 * per-instance transform formula below is copied verbatim from the source.
 *
 * A plot's crop KIND never changes during a session (`FARM_PLOTS` in
 * farm-layout.ts fixes one `productId` per bed id), so the per-kind
 * geometries (stem/leaf/fruit shape) are built once at construction and only
 * their instance transforms/materials are mutated on `update()` — matching
 * the source's per-frame recompute of `stems`/`leaves`/`fruits` without
 * rebuilding the InstancedMesh objects themselves every call.
 */

export type FarmCropKind = "tomato" | "apple" | "orange" | "wheat" | "corn" | "coffee";

export function farmCropKind(productId: CropState["productId"]): FarmCropKind {
  if (productId === "apples") return "apple";
  if (productId === "oranges") return "orange";
  if (productId === "wheat") return "wheat";
  if (productId === "corn") return "corn";
  if (productId === "coffee") return "coffee";
  return "tomato";
}

const TOMATO_GRID: readonly [number, number][] = Array.from({ length: 15 }, (_, index): [number, number] => [((index % 5) - 2) * 0.3, (Math.floor(index / 5) - 1) * 0.3]);
const WHEAT_GRID: readonly [number, number][] = Array.from({ length: 28 }, (_, index): [number, number] => [((index % 7) - 3) * 0.215, (Math.floor(index / 7) - 1.5) * 0.205]);
const CORN_GRID: readonly [number, number][] = Array.from({ length: 12 }, (_, index): [number, number] => [((index % 4) - 1.5) * 0.39, (Math.floor(index / 4) - 1) * 0.31]);
/** Three young apple trees along the bed. */
const APPLE_GRID: readonly [number, number][] = [[-0.62, 0.06], [0, -0.1], [0.62, 0.06]];
/** Six coffee bushes in two rows; ripe crowns (radius ≈ 0.21) stay inside the timbers. */
const COFFEE_GRID: readonly [number, number][] = [[-0.62, -0.28], [0, -0.31], [0.62, -0.28], [-0.62, 0.3], [0, 0.27], [0.62, 0.3]];

const BED_TIMBERS: readonly InstanceTransform[] = [
  { position: [0, 0.17, -0.62], scale: [2.05, 0.21, 0.1] },
  { position: [0, 0.17, 0.62], scale: [2.05, 0.21, 0.1] },
  { position: [-0.98, 0.17, 0], scale: [0.1, 0.21, 1.18] },
  { position: [0.98, 0.17, 0], scale: [0.1, 0.21, 1.18] },
  ...[-0.98, 0.98].flatMap((x) => [-0.62, 0.62].map((z): InstanceTransform => ({ position: [x, 0.26, z], scale: [0.14, 0.38, 0.14] }))),
];
const BED_FURROWS: readonly InstanceTransform[] = [-0.32, 0, 0.32].map((z) => ({ position: [0, 0.255, z], scale: [1.72, 0.025, 0.11] }));
const BED_DRIP_LINES: readonly InstanceTransform[] = [-0.16, 0.16].map((z) => ({ position: [0, 0.286, z], rotation: [0, 0, Math.PI / 2], scale: [1, 1.72, 1] }));
const EMPTY_SEED_HOLES: readonly InstanceTransform[] = TOMATO_GRID.map(([x, z]) => ({ position: [x, 0.282, z], scale: [1, 0.32, 1] }));
const READY_SPARKLES: readonly InstanceTransform[] = [
  { position: [-0.78, 0.1, -0.42], scale: [0.7, 0.7, 0.7] },
  { position: [0.8, 0.18, 0.31], scale: [0.55, 0.55, 0.55] },
  { position: [0.62, 0.08, -0.48], scale: [0.42, 0.42, 0.42] },
];

function cropGrid(crop: FarmCropKind): readonly [number, number][] {
  if (crop === "wheat") return WHEAT_GRID;
  if (crop === "corn") return CORN_GRID;
  if (crop === "apple") return APPLE_GRID;
  if (crop === "coffee") return COFFEE_GRID;
  return TOMATO_GRID;
}

function cropFullHeight(crop: FarmCropKind) {
  if (crop === "corn") return 1.06;
  if (crop === "apple") return 0.82;
  if (crop === "wheat") return 0.76;
  if (crop === "coffee") return 0.6;
  return 0.68;
}

function stemGeometry(crop: FarmCropKind) {
  return new THREE.CylinderGeometry(crop === "wheat" ? 0.01 : 0.018, crop === "wheat" ? 0.015 : 0.024, 1, 6);
}

function fruitGeometry(crop: FarmCropKind): THREE.BufferGeometry {
  if (crop === "coffee") return new THREE.SphereGeometry(0.036, 8, 6);
  if (crop === "orange") return new THREE.IcosahedronGeometry(0.068, 1);
  if (crop === "apple") return new THREE.SphereGeometry(0.064, 10, 8);
  if (crop === "tomato") return new THREE.DodecahedronGeometry(0.068, 0);
  if (crop === "wheat") return new THREE.ConeGeometry(0.045, 0.17, 6);
  return new THREE.SphereGeometry(0.075, 8, 6); // corn
}

function fruitCapacity(crop: FarmCropKind, gridLength: number) {
  if (crop === "apple") return gridLength * 6;
  if (crop === "coffee") return gridLength * 5;
  if (crop === "tomato" || crop === "orange") return gridLength * 2;
  return gridLength;
}

function stemColor(crop: FarmCropKind, ready: boolean): string {
  if (crop === "apple") return "#6b4a30";
  if (crop === "coffee") return "#5a3b26";
  if (crop === "wheat" && ready) return "#b89337";
  return "#4d7d3d";
}

function leafColor(crop: FarmCropKind): string {
  if (crop === "corn") return "#4f8a43";
  if (crop === "wheat") return "#729348";
  if (crop === "apple") return "#3f7f3d";
  if (crop === "coffee") return "#2f6d38";
  return "#438345";
}

function fruitColor(crop: FarmCropKind, ready: boolean, growth: number): string {
  if (crop === "orange") return ready ? "#D58236" : growth > 0.78 ? "#b78b3e" : "#79a24b";
  if (crop === "apple") return ready ? "#cf3a33" : growth > 0.78 ? "#c9803a" : "#8fae4a";
  if (crop === "tomato") return ready ? "#df4035" : growth > 0.78 ? "#d98339" : "#79a24b";
  if (crop === "wheat") return ready ? "#e8bd4c" : "#a4b15b";
  if (crop === "coffee") return ready ? "#c5322c" : growth > 0.78 ? "#d0862f" : "#7fae4c";
  return ready ? "#f2c53f" : "#83a950"; // corn
}

function computeStems(crop: FarmCropKind, grid: readonly [number, number][], height: number): InstanceTransform[] {
  return grid.map(([x, z], index) => ({
    position: [x, 0.25 + height / 2, z],
    rotation: [0, index * 0.49, (index % 3 - 1) * 0.025],
    scale: crop === "apple" ? [2.6, height, 2.6] : crop === "coffee" ? [1.6, height, 1.6] : [1, height, 1],
  }));
}

function computeLeaves(crop: FarmCropKind, grid: readonly [number, number][], growth: number, height: number): InstanceTransform[] {
  return grid.flatMap(([x, z], index) => [-1, 1].map((side): InstanceTransform => (crop === "apple"
    // Two overlapping crowns per trunk make a round canopy that grows with the tree.
    ? {
      position: [x + side * 0.08, 0.3 + height + 0.06 * growth, z + side * 0.04],
      rotation: [0, index * 0.77 + side * 0.4, 0],
      scale: [1.9 + growth, 1.5 + growth * 0.9, 1.9 + growth],
    }
    // A coffee bush: a low woody stem under a compact, glossy crown.
    : crop === "coffee"
    ? {
      position: [x + side * 0.07, 0.3 + height * 0.9 + 0.04 * growth, z + side * 0.05],
      rotation: [0, index * 0.77 + side * 0.4, 0],
      scale: [1.25 + growth * 0.55, 1.05 + growth * 0.45, 1.25 + growth * 0.55],
    }
    : {
      position: [x + side * (crop === "corn" ? 0.075 : 0.055), 0.28 + height * (side > 0 ? 0.5 : 0.68), z],
      rotation: [0, index * 0.77, side * (crop === "corn" ? 0.72 : 0.56)],
      scale: crop === "corn" ? [1.25, 0.23, 0.48] : crop === "wheat" ? [0.48, 0.12, 0.24] : [0.9, 0.2, 0.42],
    })));
}

function computeFruits(crop: FarmCropKind, grid: readonly [number, number][], height: number, fruitGrowth: number, ready: boolean, available: number, yieldCapacity: number): InstanceTransform[] {
  if (fruitGrowth <= 0) return [];
  const authored: InstanceTransform[] = crop === "apple"
    ? grid.flatMap(([x, z], tree) => Array.from({ length: 6 }, (_, slot): InstanceTransform => {
        const angle = slot * Math.PI / 3 + tree * 0.45;
        // On the crown surface (crown radius ≈ 0.33 when ripe), never inside it.
        return {
          position: [x + Math.cos(angle) * 0.37, 0.3 + height + 0.04 + Math.sin(angle * 1.7 + tree) * 0.12, z + Math.sin(angle) * 0.33],
          scale: [fruitGrowth, fruitGrowth, fruitGrowth],
        };
      }))
    // Coffee cherries sit on the crown surface, five per bush.
    : crop === "coffee"
    ? grid.flatMap(([x, z], bush) => Array.from({ length: 5 }, (_, slot): InstanceTransform => {
        const angle = slot * Math.PI * 2 / 5 + bush * 0.6;
        return {
          position: [x + Math.cos(angle) * 0.2, 0.3 + height * 0.9 + Math.sin(angle * 1.9 + bush) * 0.08, z + Math.sin(angle) * 0.19],
          scale: [fruitGrowth * 0.9, fruitGrowth * 0.9, fruitGrowth * 0.9],
        };
      }))
    : crop === "tomato" || crop === "orange"
    ? grid.flatMap(([x, z], index) => [-1, 1].map((side): InstanceTransform => ({
        position: [x + side * 0.075, 0.31 + height * (0.56 + (index % 2) * 0.13), z + (index % 3 - 1) * 0.025],
        scale: [fruitGrowth, fruitGrowth * 0.88, fruitGrowth],
      })))
    : grid.map(([x, z], index): InstanceTransform => ({
        position: crop === "wheat" ? [x, 0.27 + height, z] : [x + (index % 2 ? 0.08 : -0.08), 0.31 + height * 0.66, z],
        rotation: crop === "corn" ? [0, index * 0.41, index % 2 ? -0.28 : 0.28] : [0, index * 0.31, 0],
        scale: crop === "corn" ? [fruitGrowth * 0.68, fruitGrowth * 1.7, fruitGrowth * 0.68] : [fruitGrowth, fruitGrowth, fruitGrowth],
      }));
  if (!ready) return authored;
  return cropVisualSlotIndices(available, yieldCapacity, authored.length).map((index) => authored[index]);
}

function buildCropCanopy(crop: FarmCropKind) {
  const grid = cropGrid(crop);
  const group = new THREE.Group();

  const stemMaterial = new THREE.MeshStandardMaterial({ color: stemColor(crop, false), roughness: 0.94 });
  const stemMesh = makeInstances(computeStems(crop, grid, 0.12), stemGeometry(crop), stemMaterial, { castShadow: true, capacity: grid.length });
  group.add(stemMesh);

  const leafMaterial = new THREE.MeshStandardMaterial({ color: leafColor(crop), roughness: 0.96 });
  const leafMesh = makeInstances(computeLeaves(crop, grid, 0, 0.12), new THREE.SphereGeometry(0.115, 7, 5), leafMaterial, { castShadow: true, capacity: grid.length * 2 });
  group.add(leafMesh);

  const fruitMaterial = new THREE.MeshStandardMaterial({ color: fruitColor(crop, false, 0), roughness: 0.84 });
  const fruitMesh = makeInstances([], fruitGeometry(crop), fruitMaterial, { castShadow: true, capacity: Math.max(1, fruitCapacity(crop, grid.length)) });
  fruitMesh.visible = false;
  group.add(fruitMesh);

  function update(growth: number, ready: boolean, available: number, yieldCapacity: number) {
    const height = Math.max(0.12, cropFullHeight(crop) * growth);
    applyInstanceTransforms(stemMesh, computeStems(crop, grid, height));
    stemMaterial.color.set(stemColor(crop, ready));
    applyInstanceTransforms(leafMesh, computeLeaves(crop, grid, growth, height));
    const fruitGrowth = Math.max(0, Math.min(1, (growth - 0.52) / 0.48));
    const fruits = computeFruits(crop, grid, height, fruitGrowth, ready, available, yieldCapacity);
    fruitMesh.visible = fruits.length > 0;
    if (fruits.length > 0) applyInstanceTransforms(fruitMesh, fruits);
    const color = fruitColor(crop, ready, growth);
    fruitMaterial.color.set(color);
    fruitMaterial.emissive.set(ready ? color : "#000000");
    fruitMaterial.emissiveIntensity = ready ? 0.14 : 0;
  }

  return { group, update };
}

function buildRaisedCropBedShell(soilMaterial: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.add(roundedBoxMesh({ args: [1.92, 0.22, 1.18], position: [0, 0.15, 0], radius: 0.13, smoothness: 3, material: soilMaterial, receiveShadow: true }));
  group.add(makeInstances(BED_TIMBERS, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#8b5b35", roughness: 0.88 }), { castShadow: true, receiveShadow: true }));
  group.add(makeInstances(BED_FURROWS, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#3e2b21", roughness: 1 }), { receiveShadow: true }));
  group.add(makeInstances(BED_DRIP_LINES, new THREE.CylinderGeometry(0.012, 0.012, 1, 6), new THREE.MeshStandardMaterial({ color: "#314b45", roughness: 0.72, metalness: 0.08 }), {}));
  return group;
}

/** `DormantCropPlot`: an unplanted bed, no crop id assigned yet or LOCKED. */
export function buildDormantCropPlot(position: Position): THREE.Group {
  const group = new THREE.Group();
  group.name = "dynamic:farm-crop";
  group.position.set(...position);
  group.add(buildRaisedCropBedShell(new THREE.MeshStandardMaterial({ color: "#704b31", roughness: 1 })));
  const boards: InstanceTransform[] = [-0.32, 0, 0.32].map((z) => ({ position: [0, 0.302, z], scale: [1.55, 0.024, 0.13] }));
  group.add(makeInstances(boards, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#9f7544", roughness: 1 }), { receiveShadow: true }));
  return group;
}

function buildReadyHarvestGlow(accent: string) {
  const group = new THREE.Group();
  group.position.set(0, 0.295, 0);

  const ringMaterial = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.76, 0.84, 28), ringMaterial);
  ring.rotation.set(-Math.PI / 2, 0, 0);
  group.add(ring);

  const sparkleMaterial = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false });
  group.add(makeInstances(READY_SPARKLES, new THREE.OctahedronGeometry(0.045, 0), sparkleMaterial));

  // The source drives this off R3F's free-running `clock.elapsedTime`
  // (unrelated to the game's simulation clock), so this uses real wall time
  // too rather than the (pausable) `nowMs` passed into `buildFarm`.
  function update() {
    const seconds = performance.now() / 1000;
    const pulse = (Math.sin(seconds * 2.25) + 1) / 2;
    ring.rotation.z = seconds * 0.16;
    ring.scale.setScalar(0.96 + pulse * 0.045);
    ringMaterial.opacity = 0.17 + pulse * 0.11;
  }

  return { group, update };
}

export interface CropPlotBuild {
  crop: FarmCropKind;
  accent: string;
  label: string;
}

export interface CropPlotUpdate {
  status: CropState["status"];
  progress: number;
  available: number;
  yieldCapacity: number;
}

/** `CropPlot`: sign + raised bed + (seed holes | growing canopy) + glow. */
export function buildCropPlot(position: Position, build: CropPlotBuild) {
  const group = new THREE.Group();
  group.name = "dynamic:farm-crop";
  group.position.set(...position);

  const sign = buildStationSign({ position: [1.35, 0, 0.25], height: 1.05, title: build.label, rowCount: 1 });
  group.add(sign.group);

  const soilMaterial = new THREE.MeshStandardMaterial({ color: "#563a29", roughness: 1 });
  group.add(buildRaisedCropBedShell(soilMaterial));

  const seedBed = makeInstances(EMPTY_SEED_HOLES, new THREE.CylinderGeometry(0.035, 0.048, 0.018, 9), new THREE.MeshStandardMaterial({ color: "#2e211a", roughness: 1 }), { receiveShadow: true });
  group.add(seedBed);

  const canopy = buildCropCanopy(build.crop);
  group.add(canopy.group);

  const glow = buildReadyHarvestGlow(build.accent);
  glow.group.visible = false;
  group.add(glow.group);

  function update(state: CropPlotUpdate) {
    const stage = state.status === "READY" ? 4 : Math.max(0, Math.min(3, Math.floor(state.progress * 4)));
    const growth = [0.18, 0.4, 0.66, 0.86, 1][stage];
    const ready = state.status === "READY";

    sign.update(ready
      ? [{ label: "LISTOS", value: `${state.available}/${state.yieldCapacity}`, tone: state.available > 0 ? "#8ce6a1" : "#ffffff" }]
      : [{ label: state.status === "EMPTY" ? "SEMBRANDO" : "CRECIENDO", value: `${Math.round(Math.max(0, Math.min(1, state.progress)) * 100)} %`, tone: "#ffd98a" }]);

    soilMaterial.color.set(state.status === "EMPTY" ? "#704b31" : ready ? "#4b3426" : "#563a29");

    const isEmpty = state.status === "EMPTY";
    seedBed.visible = isEmpty;
    canopy.group.visible = !isEmpty;
    if (!isEmpty) canopy.update(growth, ready, state.available, state.yieldCapacity);

    const showGlow = ready && state.available > 0;
    glow.group.visible = showGlow;
    if (showGlow) glow.update();
  }

  return { group, update };
}
