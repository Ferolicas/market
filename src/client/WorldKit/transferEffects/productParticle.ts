import * as THREE from "three";
import type { ProductId } from "@/game/types";
import { budgetPath, loadGltf } from "@/client/WorldAssets";
import { STORE_ELEMENT_SCALE } from "@/game/world-scale";
import { buildBasketProductMesh } from "../retail/basketProduct";

/**
 * Shared visual building blocks for the four magnet-burst particle types
 * (`transferEffects/bursts.ts`). Every geometry/material/color number here
 * is copied verbatim from `MarketScene.tsx`'s `HarvestMagnetBurst` /
 * `StockMagnetBurst` / `ReturnMagnetBurst` / `PayMagnetBurst` (the "sparkle"
 * octahedron each carried-product particle wears, and the `CashBundle` the
 * pay burst throws), not re-derived.
 */

type DeliveredParticleProductId = "milk" | "cheese" | "eggs";
const DELIVERED_GLB_ID: Record<DeliveredParticleProductId, "milk" | "cheese" | "egg"> = { milk: "milk", cheese: "cheese", eggs: "egg" };

function isDeliveredParticleProduct(productId: ProductId): productId is DeliveredParticleProductId {
  return productId === "milk" || productId === "cheese" || productId === "eggs";
}

/**
 * Adds one flying unit's product mesh into `host` — the exact carried
 * replica `BasketProduct` builds (already ported 1:1 as
 * `buildBasketProductMesh`), reused rather than redefined.
 *
 * Milk/cheese/eggs route through the real `delivered/*.glb` the rest of the
 * client already loads, exactly like the source's `BasketProduct` does
 * (`DeliveredModel`, inside a `<Suspense fallback={null}>`). `loadGltf`'s
 * module-level cache means this resolves instantly once `buildFurniture()`'s
 * own delivered-assets load has completed — which, by the time any transfer
 * can fire (it needs a live interaction, only possible once the scene is
 * already built), always has. The mesh is attached a tick late in the cold
 * case instead of a low-poly stand-in, mirroring that Suspense fallback of
 * "show nothing until the GLB is ready" rather than showing the wrong thing.
 * `isDisposed` guards against attaching into a burst that landed and was
 * torn down before the promise resolved.
 */
export function attachProductParticle(host: THREE.Group, productId: ProductId, scale: number, isDisposed: () => boolean): void {
  if (!isDeliveredParticleProduct(productId)) {
    host.add(buildBasketProductMesh(productId, { scale }));
    return;
  }
  loadGltf(budgetPath("delivered", DELIVERED_GLB_ID[productId]))
    .then((gltf) => {
      if (isDisposed()) return;
      host.add(buildBasketProductMesh(productId, { scale }, gltf.scene));
    })
    .catch(() => {});
}

// ─── Sparkle (the small tumbling octahedron riding every carried unit) ─────
// HarvestMagnetBurst: <octahedronGeometry args={[0.035, 0]} /> at [0.1, 0.1, 0],
// rotation [0, 0, PI/4], color #fff1a6 opacity 0.9.
const harvestSparkleGeometry = new THREE.OctahedronGeometry(0.035, 0);
const harvestSparkleMaterial = new THREE.MeshBasicMaterial({ color: "#fff1a6", transparent: true, opacity: 0.9, depthWrite: false });
// Stock/ReturnMagnetBurst: <octahedronGeometry args={[0.03, 0]} /> at [0, 0.1, 0],
// no rotation, color #fff1a6 opacity 0.82.
const stockSparkleGeometry = new THREE.OctahedronGeometry(0.03, 0);
const stockSparkleMaterial = new THREE.MeshBasicMaterial({ color: "#fff1a6", transparent: true, opacity: 0.82, depthWrite: false });

export function buildHarvestSparkle(): THREE.Mesh {
  const mesh = new THREE.Mesh(harvestSparkleGeometry, harvestSparkleMaterial);
  mesh.position.set(0.1, 0.1, 0);
  mesh.rotation.set(0, 0, Math.PI / 4);
  return mesh;
}

export function buildStockSparkle(): THREE.Mesh {
  const mesh = new THREE.Mesh(stockSparkleGeometry, stockSparkleMaterial);
  mesh.position.set(0, 0.1, 0);
  return mesh;
}

// ─── Cash bundle (PayMagnetBurst's flying unit) ────────────────────────────
// `CashBundle()` in MarketScene.tsx: a group scaled by STORE_ELEMENT_SCALE
// holding the green bundle box and its cream paper band.
const CASH_BUNDLE_SIZE: readonly [number, number, number] = [0.2, 0.05, 0.1];
const cashBundleGeometry = new THREE.BoxGeometry(...CASH_BUNDLE_SIZE);
const cashBundleMaterial = new THREE.MeshStandardMaterial({ color: "#79b063", roughness: 0.85 });
const cashBandGeometry = new THREE.BoxGeometry(0.07, CASH_BUNDLE_SIZE[1] + 0.006, CASH_BUNDLE_SIZE[2] + 0.006);
const cashBandMaterial = new THREE.MeshStandardMaterial({ color: "#efe3b8", roughness: 0.9 });

export function buildCashBundleMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "product:cash-bundle";
  group.scale.setScalar(STORE_ELEMENT_SCALE);
  const bundle = new THREE.Mesh(cashBundleGeometry, cashBundleMaterial);
  const band = new THREE.Mesh(cashBandGeometry, cashBandMaterial);
  group.add(bundle, band);
  return group;
}
