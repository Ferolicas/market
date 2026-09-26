import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { ProductId } from "@/game/types";
import { deliveredProductId } from "@/components/game/DeliveredModel";
import { cornLabelGeometry, cornLabelMaterial, cornTinGeometry, cornTinMaterial } from "@/components/game/CannedCornModel";
import type { Position } from "../primitives";

/**
 * Faithful port of `BasketProduct` from `HarvestBasket.tsx` — the small
 * "carried/photographed" replica geometry, deliberately NOT the same numbers
 * as `RetailProduct`/`RetailProductBatch` in `retailProducts.ts` (those are
 * the shelf-scale units). This is used by `StockScreen`'s render-texture
 * photo and by `ProduceSlotSign`'s slot replica, exactly like the source
 * reuses `BasketProduct` for both. Milk/cheese/eggs go through the same
 * `DeliveredModel` GLB the rest of the client already loads — the caller
 * passes the loaded scene in (`deliveredScene`), never a low-poly stand-in.
 *
 * Note: HarvestBasket.tsx's `rounded()` helper uses
 * `three/examples/jsm/geometries/RoundedBoxGeometry.js`, a DIFFERENT
 * algorithm from `primitives.ts`'s drei-faithful `makeRoundedBoxGeometry`
 * (see that file's own doc comment). Bread/pack geometry here uses the same
 * three/examples class the source does, not `primitives.ts`'s box.
 */

const standard = (color: string, roughness = 1) => new THREE.MeshStandardMaterial({ color, roughness });
const rounded = (width: number, height: number, depth: number, radius: number, smoothness: number) => new RoundedBoxGeometry(width, height, depth, smoothness, radius);

const productGeometry = {
  orange: new THREE.IcosahedronGeometry(0.085, 1),
  fruit: new THREE.SphereGeometry(0.085, 12, 8),
  tomatoCrown: new THREE.ConeGeometry(0.045, 0.038, 5),
  appleCrown: new THREE.ConeGeometry(0.045, 0.055, 5),
  cornBody: new THREE.SphereGeometry(0.067, 12, 8),
  cornHusk: new THREE.SphereGeometry(0.075, 8, 6),
  wheatStem: new THREE.CylinderGeometry(0.009, 0.012, 0.18, 6),
  wheatHead: new THREE.SphereGeometry(0.035, 8, 6),
  egg: new THREE.SphereGeometry(0.072, 12, 8),
  bottle: new THREE.CylinderGeometry(0.045, 0.052, 0.18, 9),
  bottleCap: new THREE.CylinderGeometry(0.023, 0.027, 0.04, 8),
  cheese: new THREE.CylinderGeometry(0.085, 0.085, 0.105, 3),
  bread: rounded(0.17, 0.13, 0.12, 0.05, 3),
  pack: rounded(0.14, 0.18, 0.1, 0.018, 2),
};
const productMaterial = {
  orange: standard("#D58236", 0.58),
  tomato: standard("#df4438", 0.76),
  apple: standard("#bd3432", 0.76),
  crown: standard("#3f7f3d", 0.9),
  corn: standard("#f2c43d", 0.82),
  husk: standard("#639848", 0.95),
  wheatStem: standard("#d9a733", 0.92),
  wheatHead: standard("#edbf45", 0.88),
  egg: standard("#f5ead1", 0.92),
  milk: standard("#f7f3e9", 0.58),
  juice: standard("#ed8442", 0.58),
  milkCap: standard("#4e91bc"),
  juiceCap: standard("#438653"),
  cheese: standard("#efbd3d", 0.78),
  bread: standard("#b87338", 0.9),
  coffee: standard("#704333", 0.86),
  flour: standard("#efe3c9", 0.86),
  pack: standard("#d7af48", 0.86),
};

export interface BasketProductOptions {
  position?: Position;
  rotation?: Position;
  scale?: number;
}

/** `BasketProduct` from HarvestBasket.tsx, ported 1:1 (same branch order,
 * same numbers). `deliveredScene` is required when `productId` is
 * milk/cheese/eggs (the only ids `deliveredProductId` resolves) — pass the
 * scene loaded by `deliveredStock.ts`'s `loadDeliveredStockAssets()`. */
export function buildBasketProductMesh(productId: ProductId, options: BasketProductOptions = {}, deliveredScene?: THREE.Object3D): THREE.Object3D {
  const position = options.position ?? [0, 0, 0];
  const rotation = options.rotation ?? [0, 0, 0];
  const scale = options.scale ?? 1;

  if (productId === "cannedCorn") {
    const group = new THREE.Group();
    group.name = "product:cannedCorn";
    group.position.set(...position);
    group.rotation.set(...rotation);
    group.scale.setScalar(scale);
    const tin = new THREE.Mesh(cornTinGeometry, cornTinMaterial);
    tin.castShadow = true;
    const label = new THREE.Mesh(cornLabelGeometry, cornLabelMaterial);
    group.add(tin, label);
    return group;
  }

  const delivered = deliveredProductId(productId);
  if (delivered) {
    if (!deliveredScene) throw new Error(`buildBasketProductMesh: missing deliveredScene for "${productId}"`);
    const clone = deliveredScene.clone(true);
    clone.name = `delivered:${delivered}`;
    clone.position.set(...position);
    clone.rotation.set(...rotation);
    clone.scale.setScalar(scale * 0.8);
    clone.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    return clone;
  }

  if (productId === "oranges") {
    const mesh = new THREE.Mesh(productGeometry.orange, productMaterial.orange);
    mesh.castShadow = true;
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.setScalar(scale);
    return mesh;
  }

  if (productId === "tomatoes" || productId === "apples") {
    const tomato = productId === "tomatoes";
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.set(...rotation);
    group.scale.setScalar(scale);
    const body = new THREE.Mesh(productGeometry.fruit, tomato ? productMaterial.tomato : productMaterial.apple);
    body.castShadow = true;
    body.scale.set(...(tomato ? [1, 0.86, 1] : [0.9, 1, 0.9]) as Position);
    const crown = new THREE.Mesh(tomato ? productGeometry.tomatoCrown : productGeometry.appleCrown, productMaterial.crown);
    crown.position.set(0, 0.075, 0);
    crown.rotation.set(0, 0, Math.PI);
    group.add(body, crown);
    return group;
  }

  if (productId === "corn") {
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.set(rotation[0], rotation[1], rotation[2] + 0.16);
    group.scale.setScalar(scale);
    const body = new THREE.Mesh(productGeometry.cornBody, productMaterial.corn);
    body.castShadow = true;
    body.scale.set(0.68, 1.28, 0.68);
    group.add(body);
    for (const side of [-1, 1]) {
      const husk = new THREE.Mesh(productGeometry.cornHusk, productMaterial.husk);
      husk.position.set(side * 0.048, -0.015, 0);
      husk.rotation.set(0, 0, side * 0.48);
      husk.scale.set(0.44, 1.1, 0.32);
      group.add(husk);
    }
    return group;
  }

  if (productId === "wheat") {
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.set(...rotation);
    group.scale.setScalar(scale);
    ([-0.045, 0, 0.045] as const).forEach((x, index) => {
      const stalk = new THREE.Group();
      stalk.position.set(x, 0, (index - 1) * 0.012);
      stalk.rotation.set(0, 0, (index - 1) * 0.1);
      const stem = new THREE.Mesh(productGeometry.wheatStem, productMaterial.wheatStem);
      stem.position.set(0, 0.04, 0);
      const head = new THREE.Mesh(productGeometry.wheatHead, productMaterial.wheatHead);
      head.position.set(0, 0.145, 0);
      head.scale.set(0.65, 1.25, 0.65);
      stalk.add(stem, head);
      group.add(stalk);
    });
    return group;
  }

  if (productId === "eggs") {
    const mesh = new THREE.Mesh(productGeometry.egg, productMaterial.egg);
    mesh.castShadow = true;
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.set(0.72 * scale, 1.02 * scale, 0.72 * scale);
    return mesh;
  }

  if (productId === "milk" || productId === "juice") {
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.set(...rotation);
    group.scale.setScalar(scale);
    const bottle = new THREE.Mesh(productGeometry.bottle, productId === "milk" ? productMaterial.milk : productMaterial.juice);
    bottle.castShadow = true;
    const cap = new THREE.Mesh(productGeometry.bottleCap, productId === "milk" ? productMaterial.milkCap : productMaterial.juiceCap);
    cap.position.set(0, 0.108, 0);
    group.add(bottle, cap);
    return group;
  }

  if (productId === "cheese") {
    const mesh = new THREE.Mesh(productGeometry.cheese, productMaterial.cheese);
    mesh.castShadow = true;
    mesh.position.set(...position);
    mesh.rotation.set(rotation[0], rotation[1], rotation[2] + Math.PI / 2);
    mesh.scale.setScalar(scale);
    return mesh;
  }

  if (productId === "bread") {
    const mesh = new THREE.Mesh(productGeometry.bread, productMaterial.bread);
    mesh.castShadow = true;
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.setScalar(scale);
    return mesh;
  }

  const packMaterial = productId === "coffee" ? productMaterial.coffee : productId === "flour" ? productMaterial.flour : productMaterial.pack;
  const mesh = new THREE.Mesh(productGeometry.pack, packMaterial);
  mesh.castShadow = true;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.setScalar(scale);
  return mesh;
}
