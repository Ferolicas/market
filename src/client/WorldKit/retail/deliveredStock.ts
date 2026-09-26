import * as THREE from "three";
import type { ProductId } from "@/game/types";
import { budgetPath, loadGltf } from "@/client/WorldAssets";
import { deliveredProductParts } from "@/components/game/CrowdProps";
import { PartsInstancer, type InstancedPart } from "@/game/render/CrowdParts";
import { RETAIL_VISUAL_CAPACITY } from "@/game/stations/retail-layout";
import { retailStockTransforms } from "../retailProducts";

/**
 * milk/cheese/eggs are the three retail SKUs `RetailProduct`/
 * `RetailProductBatch` in MarketKit.tsx do NOT model procedurally —
 * `deliveredProductId()` routes them to the real `DeliveredModel`/
 * `DeliveredProductInstances` GLB (`/models/market/budget/delivered/{milk,
 * cheese,egg}.glb`, the same files `ClientRuntime.loadDeliveredProducts()`
 * already loads for carried units). This module loads those same three GLBs
 * once and instances them at the exact per-unit transforms
 * `retailStockTransforms()` (ported from `AuthoritativeRetailStock`) computes
 * — no low-poly substitute, no re-derived geometry.
 *
 * It also loads the two other `delivered/` fixture props `departments.ts`
 * needs verbatim from the source: `dairy` (the animated-door cooler case in
 * `ChilledDisplay`, ported from `DeliveredDairy.tsx`) and `egg-display` (the
 * static case in `EggDisplay`, ported from `DeliveredModel`) — same GLB
 * family, same loader, so one asset-loading entry point for the whole
 * "retail" module tree.
 */

/** Product SKUs modeled by a real delivered GLB (instanced per shelf unit). */
export type DeliveredGlbId = "milk" | "cheese" | "egg";
export type DeliveredRetailProductId = "milk" | "cheese" | "eggs";
/** Every `delivered/*.glb` this module loads, product SKUs plus the two
 * static fixture props `ChilledDisplay`/`EggDisplay` mount once each. */
export type DeliveredAssetId = DeliveredGlbId | "dairy" | "egg-display";

const GLB_ID_FOR_PRODUCT: Record<DeliveredRetailProductId, DeliveredGlbId> = { milk: "milk", cheese: "cheese", eggs: "egg" };
const DELIVERED_ASSET_IDS = ["milk", "cheese", "egg", "dairy", "egg-display"] as const satisfies readonly DeliveredAssetId[];

export interface DeliveredStockAssets {
  /** Raw loaded scene per GLB id — used by `stockScreen.ts` to build the
   * mini render-texture photo for a delivered SKU (`BasketProduct`'s
   * `DeliveredModel` branch), and by `departments.ts` to mount the `dairy`
   * and `egg-display` fixture props. */
  scenes: ReadonlyMap<DeliveredAssetId, THREE.Group>;
  /** Instanced parts per retail product id — `DeliveredProductInstances`
   * ported to `InstancedPart[]`, scale 1 (the source's `productParts()`
   * clones raw geometry with no extra scale factor; that 0.8 shrink only
   * applies to the carried/basket context, not the shelf display). */
  parts: ReadonlyMap<DeliveredRetailProductId, InstancedPart[]>;
}

export async function loadDeliveredStockAssets(): Promise<DeliveredStockAssets> {
  const scenes = new Map<DeliveredAssetId, THREE.Group>();
  const parts = new Map<DeliveredRetailProductId, InstancedPart[]>();
  await Promise.all(DELIVERED_ASSET_IDS.map(async (assetId) => {
    const gltf = await loadGltf(budgetPath("delivered", assetId));
    scenes.set(assetId, gltf.scene);
    if (assetId === "dairy" || assetId === "egg-display") return;
    const productId: DeliveredRetailProductId = assetId === "egg" ? "eggs" : assetId;
    parts.set(productId, deliveredProductParts(gltf.scene, 1));
  }));
  return { scenes, parts };
}

/** Clones the `dairy`/`egg-display` scene for one fixture mount, same
 * cast/receive-shadow flags `DeliveredModel`/`DeliveredDairy` apply. */
export function cloneDeliveredScene(assets: DeliveredStockAssets, assetId: DeliveredAssetId): THREE.Group {
  const scene = assets.scenes.get(assetId);
  if (!scene) throw new Error(`cloneDeliveredScene: "${assetId}" was not loaded`);
  const clone = scene.clone(true);
  clone.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
  return clone;
}

const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchScale = new THREE.Vector3();

export interface DeliveredStockGroup {
  group: THREE.Group;
  /** Re-lays every visible unit for a new authoritative count — mirrors
   * `updateRetailStockGroup` for the procedural SKUs. */
  update(count: number): void;
}

/** Imperative equivalent of `RetailProductBatch`'s delivered branch
 * (`DeliveredProductInstances`) for one SKU (`milk`, `cheese` or `eggs`). */
export function buildDeliveredStockGroup(assets: DeliveredStockAssets, productId: DeliveredRetailProductId, count: number): DeliveredStockGroup | null {
  const parts = assets.parts.get(productId);
  if (!parts || parts.length === 0) return null;
  const group = new THREE.Group();
  group.name = `retail-stock:${productId}`;
  const capacity = RETAIL_VISUAL_CAPACITY[productId];
  const instancer = new PartsInstancer(parts, capacity, `retail-stock:${productId}`);
  for (const mesh of instancer.meshes) { mesh.castShadow = true; mesh.receiveShadow = true; }
  instancer.attach(group);

  const update = (nextCount: number) => {
    const { transforms } = retailStockTransforms(productId, nextCount);
    instancer.begin();
    for (const transform of transforms) {
      scratchPosition.set(...transform.position);
      scratchScale.set(...(transform.scale ?? [1, 1, 1]));
      if (transform.quaternion) scratchQuaternion.set(...transform.quaternion);
      else scratchQuaternion.setFromEuler(scratchEuler.set(...(transform.rotation ?? [0, 0, 0])));
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
      instancer.push(scratchMatrix);
    }
    instancer.end();
  };
  update(count);
  return { group, update };
}

export function deliveredGlbIdForProduct(productId: DeliveredRetailProductId): DeliveredGlbId {
  return GLB_ID_FOR_PRODUCT[productId];
}

export function isDeliveredRetailProduct(productId: ProductId): productId is DeliveredRetailProductId {
  return productId === "milk" || productId === "cheese" || productId === "eggs";
}
