import * as THREE from "three";
import type { ProductId } from "@/game/types";
import { PRODUCE_DECK, RETAIL_VISUAL_CAPACITY, retailStockLandingLocalPosition } from "@/game/stations/retail-layout";
import { cornLabelGeometry, cornLabelMaterial, cornTinGeometry, cornTinMaterial } from "@/components/game/CannedCornModel";
import { applyInstanceTransforms, makeInstances, makeRoundedBoxGeometry, type InstanceTransform, type Position } from "./primitives";

/**
 * Faithful port of `RetailProduct`/`RetailProductBatch`/
 * `AuthoritativeRetailStock` from `MarketKit.tsx`. Every geometry arg,
 * color, and per-part transform below is copied verbatim from the source —
 * these are the numbers a customer actually sees on `/`, not a
 * re-derivation. `milk`/`cheese`/`eggs` are NOT here: `deliveredProductId()`
 * in the source makes those three real GLB models
 * (`budgetPath("delivered", id)`, already loaded by
 * `ClientRuntime.loadDeliveredProducts()`); see `deliveredStock.ts` for
 * their instancing, which reuses that same loader — no low-poly substitute,
 * same GLBs `/` uses via `DeliveredModel`.
 */

const materials = {
  orange: new THREE.MeshStandardMaterial({ color: "#D58236", roughness: 0.58 }),
  tomatoBody: new THREE.MeshStandardMaterial({ color: "#d94838", roughness: 0.78 }),
  tomatoCrown: new THREE.MeshStandardMaterial({ color: "#37743e", roughness: 0.9 }),
  appleBody: new THREE.MeshStandardMaterial({ color: "#bd3432", roughness: 0.72 }),
  appleStem: new THREE.MeshStandardMaterial({ color: "#5b3c27" }),
  appleLeaf: new THREE.MeshStandardMaterial({ color: "#4e873f", roughness: 0.9 }),
  cornBody: new THREE.MeshStandardMaterial({ color: "#f0bf36", roughness: 0.85 }),
  cornHusk: new THREE.MeshStandardMaterial({ color: "#5d9348", roughness: 0.95 }),
  juiceBottle: new THREE.MeshStandardMaterial({ color: "#ee8643", roughness: 0.58 }),
  juiceCap: new THREE.MeshStandardMaterial({ color: "#438653", roughness: 0.6 }),
  juiceLabel: new THREE.MeshStandardMaterial({ color: "#fff0c6" }),
  breadBody: new THREE.MeshStandardMaterial({ color: "#b97336", roughness: 0.9 }),
  breadScore: new THREE.MeshStandardMaterial({ color: "#e7bd75" }),
} as const;

const geometries = {
  orange: new THREE.IcosahedronGeometry(0.09, 1),
  tomatoBody: new THREE.SphereGeometry(0.09, 14, 10),
  tomatoCrown: new THREE.ConeGeometry(0.052, 0.045, 5),
  appleBody: new THREE.SphereGeometry(0.085, 14, 10),
  appleStem: new THREE.CylinderGeometry(0.009, 0.012, 0.065, 6),
  appleLeaf: new THREE.SphereGeometry(0.045, 8, 5),
  cornBody: new THREE.SphereGeometry(0.075, 12, 8),
  cornHusk: new THREE.SphereGeometry(0.082, 9, 6),
  juiceBottle: new THREE.CylinderGeometry(0.055, 0.064, 0.22, 10),
  juiceCap: new THREE.CylinderGeometry(0.03, 0.034, 0.055, 9),
  juiceLabel: new THREE.PlaneGeometry(0.075, 0.09),
  breadBody: makeRoundedBoxGeometry(0.22, 0.16, 0.15, 0.065, { smoothness: 3 }),
  breadScore: new THREE.BoxGeometry(0.012, 0.06, 0.158),
  package: makeRoundedBoxGeometry(0.17, 0.24, 0.12, 0.022, { smoothness: 2 }),
} as const;

function packageColor(productId: "coffee" | "flour" | "wheat") {
  return productId === "coffee" ? "#6b3d2d" : productId === "flour" ? "#eee4cc" : "#d5ab42";
}
function packageLabelColor(productId: "coffee" | "flour" | "wheat") {
  return productId === "coffee" ? "#fff1d0" : "#765a34";
}
const packageMaterials = new Map<string, THREE.MeshStandardMaterial>();
function packageMaterial(productId: "coffee" | "flour" | "wheat"): THREE.MeshStandardMaterial {
  const key = `pkg:${productId}`;
  let material = packageMaterials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color: packageColor(productId), roughness: 0.72 });
    packageMaterials.set(key, material);
  }
  return material;
}
const packageLabelMaterials = new Map<string, THREE.MeshStandardMaterial>();
function packageLabelMaterial(productId: "coffee" | "flour" | "wheat"): THREE.MeshStandardMaterial {
  const key = `pkglabel:${productId}`;
  let material = packageLabelMaterials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color: packageLabelColor(productId), roughness: 0.75 });
    packageLabelMaterials.set(key, material);
  }
  return material;
}
const packageLabelGeometry = new THREE.PlaneGeometry(0.11, 0.075);

const PRODUCE_IDS = ["tomatoes", "oranges", "apples", "corn"] as const;

/** `AuthoritativeRetailStock`: visible unit count, capped, and its per-unit
 * transform (produce gets `PRODUCE_DECK.tilt` on X, matching the source). */
export function retailStockTransforms(productId: ProductId, count: number): { transforms: InstanceTransform[]; capacity: number } {
  const capacity = RETAIL_VISUAL_CAPACITY[productId];
  const visualCount = Math.min(capacity, Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)));
  const scale = productId === "eggs" || (PRODUCE_IDS as readonly string[]).includes(productId) ? 0.9 : 0.92;
  const isProduce = (PRODUCE_IDS as readonly string[]).includes(productId);
  const transforms = Array.from({ length: visualCount }, (_, ordinal) => ({
    position: retailStockLandingLocalPosition(productId, ordinal, visualCount),
    rotation: isProduce ? ([PRODUCE_DECK.tilt, 0, 0] as Position) : undefined,
    scale: [scale, scale, scale] as Position,
  }));
  return { transforms, capacity };
}

/** One `THREE.Group` per SKU holding every instanced sub-part (body, crown,
 * stem, husk, cap, label, score marks...) — the imperative equivalent of
 * `RetailProductBatch`. Call `updateRetailStockGroup` on a stock-count
 * change instead of rebuilding: it only touches instance transforms/counts. */
export function buildRetailStockGroup(productId: ProductId, count: number): THREE.Group | null {
  const group = new THREE.Group();
  group.name = `retail-stock:${productId}`;
  const { transforms, capacity } = retailStockTransforms(productId, count);
  const parts = retailStockParts(productId);
  if (!parts) return null; // cannedCorn/milk/cheese/eggs handled elsewhere
  for (const part of parts) {
    const mesh = makeInstances(transforms, part.geometry, part.material, { capacity, component: part.component, castShadow: part.castShadow });
    mesh.name = `retail-stock-part:${productId}`;
    group.add(mesh);
  }
  return group;
}

export function updateRetailStockGroup(group: THREE.Group, productId: ProductId, count: number) {
  const { transforms, capacity } = retailStockTransforms(productId, count);
  const parts = retailStockParts(productId);
  if (!parts) return;
  group.children.forEach((child, index) => {
    if (child instanceof THREE.InstancedMesh) applyInstanceTransforms(child, transforms, parts[index]?.component);
  });
  void capacity;
}

interface RetailPart { geometry: THREE.BufferGeometry; material: THREE.Material; component?: InstanceTransform; castShadow?: boolean; }

function retailStockParts(productId: ProductId): RetailPart[] | null {
  switch (productId) {
    case "oranges":
      return [{ geometry: geometries.orange, material: materials.orange, castShadow: true }];
    case "tomatoes":
      return [
        { geometry: geometries.tomatoBody, material: materials.tomatoBody, component: { position: [0, 0, 0], scale: [1, 0.86, 1] }, castShadow: true },
        { geometry: geometries.tomatoCrown, material: materials.tomatoCrown, component: { position: [0, 0.078, 0], rotation: [0, 0, Math.PI] } },
      ];
    case "apples":
      return [
        { geometry: geometries.appleBody, material: materials.appleBody, component: { position: [0, 0, 0], scale: [0.92, 1, 0.92] }, castShadow: true },
        { geometry: geometries.appleStem, material: materials.appleStem, component: { position: [0, 0.102, 0] } },
        { geometry: geometries.appleLeaf, material: materials.appleLeaf, component: { position: [0.045, 0.112, 0], rotation: [0, 0, -0.55], scale: [1, 0.35, 0.55] } },
      ];
    case "corn":
      return [
        { geometry: geometries.cornBody, material: materials.cornBody, component: { position: [0, 0, 0], scale: [0.62, 1.22, 0.62] }, castShadow: true },
        { geometry: geometries.cornHusk, material: materials.cornHusk, component: { position: [-0.048, -0.02, 0], rotation: [0, 0, -0.38], scale: [0.45, 1, 0.35] } },
        { geometry: geometries.cornHusk, material: materials.cornHusk, component: { position: [0.048, -0.02, 0], rotation: [0, 0, 0.38], scale: [0.45, 1, 0.35] } },
      ];
    case "juice":
      return [
        { geometry: geometries.juiceBottle, material: materials.juiceBottle, castShadow: true },
        { geometry: geometries.juiceCap, material: materials.juiceCap, component: { position: [0, 0.135, 0] } },
        { geometry: geometries.juiceLabel, material: materials.juiceLabel, component: { position: [0, 0, 0.061] } },
      ];
    case "bread":
      return [
        { geometry: geometries.breadBody, material: materials.breadBody, castShadow: true },
        { geometry: geometries.breadScore, material: materials.breadScore, component: { position: [-0.05, 0.073, 0], rotation: [0, 0, -0.3] } },
        { geometry: geometries.breadScore, material: materials.breadScore, component: { position: [0.02, 0.073, 0], rotation: [0, 0, -0.3] } },
        { geometry: geometries.breadScore, material: materials.breadScore, component: { position: [0.085, 0.073, 0], rotation: [0, 0, -0.3] } },
      ];
    case "cannedCorn":
      return [
        { geometry: cornTinGeometry, material: cornTinMaterial, castShadow: true },
        { geometry: cornLabelGeometry, material: cornLabelMaterial },
      ];
    case "coffee":
    case "flour":
    case "wheat":
      return [
        { geometry: geometries.package, material: packageMaterial(productId), castShadow: true },
        { geometry: packageLabelGeometry, material: packageLabelMaterial(productId), component: { position: [0, 0, 0.064] } },
      ];
    default:
      return null; // milk/cheese/eggs: real delivered GLB, see deliveredStock.ts
  }
}
