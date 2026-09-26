import * as THREE from "three";
import type { ProductId } from "@/game/types";
import { deliveredModelPath, deliveredProductId } from "@/components/game/DeliveredModel";
import { cornLabelGeometry, cornLabelMaterial, cornTinGeometry, cornTinMaterial } from "@/components/game/CannedCornModel";
import { loadGltf } from "@/client/WorldAssets";
import { makeRoundedBoxGeometry, makeText, type Position } from "../primitives";

/**
 * Faithful port of `RetailProduct` from `MarketKit.tsx` for a SINGLE unit
 * (the imperative equivalent of one `<RetailProduct .../>` call, not the
 * instanced `RetailProductBatch`). Used by `checkoutKit.ts`'s
 * `CheckoutProductUnit` (a unit riding the belt) and `returnsCubicle.ts`
 * (units sitting on the returns shelf) — the only two places in the source
 * that render `RetailProduct` for a single, individually-addressable unit
 * rather than a shelf batch.
 *
 * Milk, cheese and "eggs" (-> "egg") are real delivered GLBs in the source
 * (`deliveredProductId()` + `<DeliveredModel>`), loaded here from the SAME
 * `deliveredModelPath` the production renderer (`/`) uses — not the play2
 * "budget" asset substitute (`budgetPath("delivered", id)` used elsewhere by
 * `RetailStockLayer`/`BudgetProductParts.ts`, which is a deliberately
 * lower-fidelity approximation for crowd-scale rendering and must NOT be
 * used here per the fidelity requirement). Because loading a GLB is async,
 * `buildRetailProductUnit` returns a group synchronously and attaches the
 * cloned model once the load resolves — visually identical to the source,
 * just arriving a frame or two later the first time a given delivered SKU
 * is needed.
 */

const geometries = {
  orange: new THREE.IcosahedronGeometry(0.09, 1),
  tomatoBody: new THREE.SphereGeometry(0.09, 14, 10),
  tomatoCrown: new THREE.ConeGeometry(0.052, 0.045, 5),
  appleBody: new THREE.SphereGeometry(0.085, 14, 10),
  appleStem: new THREE.CylinderGeometry(0.009, 0.012, 0.065, 6),
  appleLeaf: new THREE.SphereGeometry(0.045, 8, 5),
  cornBody: new THREE.SphereGeometry(0.075, 12, 8),
  cornHusk: new THREE.SphereGeometry(0.082, 9, 6),
  bottle: new THREE.CylinderGeometry(0.055, 0.064, 0.22, 10),
  cap: new THREE.CylinderGeometry(0.03, 0.034, 0.055, 9),
  label: new THREE.PlaneGeometry(0.075, 0.09),
  bread: makeRoundedBoxGeometry(0.22, 0.16, 0.15, 0.065, { smoothness: 3 }),
  breadScore: new THREE.BoxGeometry(0.012, 0.06, 0.158),
  package: makeRoundedBoxGeometry(0.17, 0.24, 0.12, 0.022, { smoothness: 2 }),
} as const;

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

const packageMaterials = new Map<string, THREE.MeshStandardMaterial>();
function packageMaterial(productId: "coffee" | "flour" | "wheat"): THREE.MeshStandardMaterial {
  const key = `pkg:${productId}`;
  let material = packageMaterials.get(key);
  if (!material) {
    const color = productId === "coffee" ? "#6b3d2d" : productId === "flour" ? "#eee4cc" : "#d5ab42";
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
    packageMaterials.set(key, material);
  }
  return material;
}

type DeliveredGlbId = "milk" | "cheese" | "egg";
const deliveredSceneCache = new Map<DeliveredGlbId, Promise<THREE.Object3D>>();
function loadDeliveredScene(id: DeliveredGlbId): Promise<THREE.Object3D> {
  let pending = deliveredSceneCache.get(id);
  if (!pending) {
    pending = loadGltf(deliveredModelPath(id)).then((gltf) => gltf.scene);
    deliveredSceneCache.set(id, pending);
  }
  return pending;
}

/** `<group name={`delivered:${id}`}><DeliveredModel id={id} .../></group>` —
 * `DeliveredModel` clones the loaded scene and marks every mesh cast/receive
 * shadow, matching the source exactly. */
function attachDeliveredClone(parent: THREE.Group, id: DeliveredGlbId) {
  loadDeliveredScene(id)
    .then((scene) => {
      const clone = scene.clone(true);
      clone.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      parent.add(clone);
    })
    .catch(() => {});
}

/** One product unit, positioned/scaled exactly like a single
 * `<RetailProduct productId position scale />` call in the source. */
export function buildRetailProductUnit(productId: ProductId, position: Position, scale = 1): THREE.Object3D {
  if (productId === "cannedCorn") {
    const group = new THREE.Group();
    group.name = `retail-product:${productId}`;
    group.position.set(...position);
    group.scale.setScalar(scale);
    const tin = new THREE.Mesh(cornTinGeometry, cornTinMaterial);
    tin.castShadow = true;
    const label = new THREE.Mesh(cornLabelGeometry, cornLabelMaterial);
    group.add(tin, label);
    return group;
  }

  const delivered = deliveredProductId(productId);
  if (delivered) {
    const group = new THREE.Group();
    group.name = `retail-product:${productId}`;
    group.position.set(...position);
    group.scale.setScalar(scale);
    attachDeliveredClone(group, delivered);
    return group;
  }

  if (productId === "oranges") {
    const mesh = new THREE.Mesh(geometries.orange, materials.orange);
    mesh.name = `retail-product:${productId}`;
    mesh.castShadow = true;
    mesh.position.set(...position);
    mesh.scale.setScalar(scale);
    return mesh;
  }

  if (productId === "tomatoes") {
    const group = new THREE.Group();
    group.name = `retail-product:${productId}`;
    group.position.set(...position);
    group.scale.setScalar(scale);
    const body = new THREE.Mesh(geometries.tomatoBody, materials.tomatoBody);
    body.castShadow = true;
    body.scale.set(1, 0.86, 1);
    const crown = new THREE.Mesh(geometries.tomatoCrown, materials.tomatoCrown);
    crown.position.set(0, 0.078, 0);
    crown.rotation.set(0, 0, Math.PI);
    group.add(body, crown);
    return group;
  }

  if (productId === "apples") {
    const group = new THREE.Group();
    group.name = `retail-product:${productId}`;
    group.position.set(...position);
    group.scale.setScalar(scale);
    const body = new THREE.Mesh(geometries.appleBody, materials.appleBody);
    body.castShadow = true;
    body.scale.set(0.92, 1, 0.92);
    const stem = new THREE.Mesh(geometries.appleStem, materials.appleStem);
    stem.position.set(0, 0.102, 0);
    const leaf = new THREE.Mesh(geometries.appleLeaf, materials.appleLeaf);
    leaf.position.set(0.045, 0.112, 0);
    leaf.rotation.set(0, 0, -0.55);
    leaf.scale.set(1, 0.35, 0.55);
    group.add(body, stem, leaf);
    return group;
  }

  if (productId === "corn") {
    const group = new THREE.Group();
    group.name = `retail-product:${productId}`;
    group.position.set(...position);
    group.scale.setScalar(scale);
    const body = new THREE.Mesh(geometries.cornBody, materials.cornBody);
    body.castShadow = true;
    body.scale.set(0.62, 1.22, 0.62);
    group.add(body);
    for (const side of [-1, 1] as const) {
      const husk = new THREE.Mesh(geometries.cornHusk, materials.cornHusk);
      husk.position.set(side * 0.048, -0.02, 0);
      husk.rotation.set(0, 0, side * 0.38);
      husk.scale.set(0.45, 1, 0.35);
      group.add(husk);
    }
    return group;
  }

  // Source's combined `milk || juice` branch is only reachable for "juice"
  // here — "milk" already returned via the delivered-GLB branch above,
  // exactly like the source (its own `milk` case is dead code there too).
  if (productId === "juice") {
    const group = new THREE.Group();
    group.name = `retail-product:${productId}`;
    group.position.set(...position);
    group.scale.setScalar(scale);
    const bottle = new THREE.Mesh(geometries.bottle, materials.juiceBottle);
    bottle.castShadow = true;
    const cap = new THREE.Mesh(geometries.cap, materials.juiceCap);
    cap.position.set(0, 0.135, 0);
    const label = new THREE.Mesh(geometries.label, materials.juiceLabel);
    label.position.set(0, 0, 0.061);
    group.add(bottle, cap, label);
    return group;
  }

  if (productId === "bread") {
    const group = new THREE.Group();
    group.name = `retail-product:${productId}`;
    group.position.set(...position);
    group.scale.setScalar(scale);
    const body = new THREE.Mesh(geometries.bread, materials.breadBody);
    body.castShadow = true;
    group.add(body);
    for (const x of [-0.05, 0.02, 0.085]) {
      const score = new THREE.Mesh(geometries.breadScore, materials.breadScore);
      score.position.set(x, 0.073, 0);
      score.rotation.set(0, 0, -0.3);
      group.add(score);
    }
    return group;
  }

  // coffee / flour / wheat package
  const packageId = productId as "coffee" | "flour" | "wheat";
  const label = packageId === "coffee" ? "CAFÉ" : packageId === "flour" ? "HARINA" : "TRIGO";
  const group = new THREE.Group();
  group.name = `retail-product:${productId}`;
  group.position.set(...position);
  group.scale.setScalar(scale);
  const box = new THREE.Mesh(geometries.package, packageMaterial(packageId));
  box.castShadow = true;
  const text = makeText({
    text: label,
    position: [0, 0, 0.064],
    fontSize: 0.037,
    color: packageId === "coffee" ? "#fff1d0" : "#59462d",
    anchorX: "center",
    anchorY: "middle",
    fontWeight: 800,
  });
  group.add(box, text);
  return group;
}
