import * as THREE from "three";
import { makeBox, makeInstances, makeRoundedBoxGeometry, palette, type InstanceTransform, type Position } from "./primitives";
import { makeText } from "./primitives";

/**
 * Faithful ports of MarketKit.tsx's shared fixture-shell pieces:
 * `DepartmentSign`, `ScreenRail`, `FixtureUprights`, `CommercialShelfBank`,
 * `CommercialBackPanel`. Every used by nearly every retail department —
 * numbers copied verbatim from the source.
 */

const steelMaterial = new THREE.MeshStandardMaterial({ color: palette.fixtureSteel, metalness: 0.58, roughness: 0.34 });
const shelfMaterial = new THREE.MeshStandardMaterial({ color: palette.shelf, roughness: 0.66 });
const shelfLipMaterial = new THREE.MeshStandardMaterial({ color: palette.fixtureSteel, metalness: 0.45, roughness: 0.36 });
const tagMaterial = new THREE.MeshStandardMaterial({ color: "#fff8e7", roughness: 0.78 });
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const backPanelSlatMaterial = new THREE.MeshStandardMaterial({ color: "#747d79", metalness: 0.38, roughness: 0.42 });

export function makeDepartmentSign({ label, color, position = [0, 1.82, 0.03], width = 1.72 }: { label: string; color: string; position?: Position; width?: number }): THREE.Group {
  const group = new THREE.Group();
  group.position.set(...position);
  group.add(makeBox({ args: [width + 0.1, 0.42, 0.07], position: [0, -0.025, -0.035], color: palette.frame, radius: 0.055 }));
  group.add(makeBox({ args: [width, 0.31, 0.09], color, radius: 0.045 }));
  const text = makeText({ text: label, position: [0, 0, 0.052], fontSize: 0.135, color: "#fffaf0", anchorX: "center", anchorY: "middle", fontWeight: 800 });
  group.add(text);
  return group;
}

export function makeScreenRail({ barY, railY, halfWidth, z }: { barY: number; railY: number; halfWidth: number; z: number }): THREE.Group {
  const group = new THREE.Group();
  const posts: InstanceTransform[] = [-halfWidth, halfWidth].map((x) => ({ position: [x, (barY + railY) / 2, z], scale: [0.05, railY - barY, 0.05] }));
  group.add(makeInstances(posts, unitBox, steelMaterial));
  group.add(makeBox({ args: [halfWidth * 2 + 0.05, 0.05, 0.05], position: [0, railY, z], color: palette.fixtureSteel, radius: 0.01 }));
  return group;
}

export function makeFixtureUprights({ width, height, z = -0.34 }: { width: number; height: number; z?: number }): THREE.InstancedMesh {
  const posts: InstanceTransform[] = [-1, 1].flatMap((side) => [z - 0.03, z + 0.09].map((postZ) => ({
    position: [side * (width / 2 - 0.055), height / 2, postZ] as Position,
    scale: [0.07, height, 0.07] as Position,
  })));
  const mesh = makeInstances(posts, unitBox, steelMaterial, { castShadow: true, receiveShadow: true });
  return mesh;
}

export function makeCommercialShelfBank({ levels, width, depth, z = 0, front = 1, accent }: { levels: readonly number[]; width: number; depth: number; z?: number; front?: -1 | 1; accent: string }): THREE.Group {
  const group = new THREE.Group();
  const decks: InstanceTransform[] = levels.map((y) => ({ position: [0, y, z], scale: [width, 0.065, depth] }));
  const lips: InstanceTransform[] = levels.map((y) => ({ position: [0, y + 0.025, z + front * (depth / 2 - 0.006)], scale: [width + 0.035, 0.105, 0.035] }));
  const accents: InstanceTransform[] = levels.map((y) => ({ position: [0, y + 0.075, z + front * (depth / 2 + 0.017)], scale: [width * 0.92, 0.062, 0.018] }));
  const tags: InstanceTransform[] = levels.flatMap((y) => [-0.31, 0, 0.31].map((offset) => ({ position: [offset * width, y + 0.075, z + front * (depth / 2 + 0.029)] as Position, scale: [0.25, 0.055, 0.012] as Position })));
  const accentMaterial = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
  group.add(makeInstances(decks, unitBox, shelfMaterial, { receiveShadow: true }));
  group.add(makeInstances(lips, unitBox, shelfLipMaterial, { castShadow: true }));
  group.add(makeInstances(accents, unitBox, accentMaterial));
  group.add(makeInstances(tags, unitBox, tagMaterial));
  return group;
}

export function makeCommercialBackPanel({ width, height, z, color = "#c5cac7" }: { width: number; height: number; z: number; color?: string }): THREE.Group {
  const group = new THREE.Group();
  group.add(makeBox({ args: [width, height, 0.075], position: [0, height / 2, z], color, radius: 0.018 }));
  const slats: InstanceTransform[] = Array.from({ length: 7 }, (_, index) => ({
    position: [0, 0.22 + index * Math.max(0.2, (height - 0.34) / 6), z + 0.042],
    scale: [width * 0.86, 0.012, 0.012],
  }));
  group.add(makeInstances(slats, unitBox, backPanelSlatMaterial));
  return group;
}

export { makeRoundedBoxGeometry };
