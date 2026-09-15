"use client";

import { forwardRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CarryState, ProductId } from "@/game/types";
import { carriedProductIds, carryQuantity, carryTotal, MAX_WAREHOUSE_PICKUP_BATCH } from "@/game/player/CarrySystem";
import { DeliveredModel, deliveredProductId } from "./DeliveredModel";
import { CannedCornModel } from "./CannedCornModel";

const standard = (color: string, roughness = 1) => new THREE.MeshStandardMaterial({ color, roughness });

/**
 * Basket geometry is built once and shared by every carried basket. Drei's
 * <RoundedBox> extrudes a fresh shape and recomputes creased normals in a
 * layout effect on every mount; fifteen of them mounting together on the
 * first harvest cost a whole frame of main-thread time on a phone.
 */
const rounded = (width: number, height: number, depth: number, radius: number, smoothness: number) => new RoundedBoxGeometry(width, height, depth, smoothness, radius);
const basketGeometry = {
  base: rounded(0.62, 0.14, 0.36, 0.055, 3),
  bed: rounded(0.55, 0.08, 0.29, 0.045, 3),
  post: rounded(0.055, 0.25, 0.035, 0.014, 2),
  frontRail: rounded(0.61, 0.035, 0.035, 0.012, 2),
  sideRail: rounded(0.035, 0.035, 0.35, 0.012, 2),
  gripBar: new THREE.CylinderGeometry(0.027, 0.027, 1, 12),
  stay: new THREE.CylinderGeometry(0.022, 0.022, 1, 10),
  grip: new THREE.SphereGeometry(0.033, 12, 8),
};
const basketMaterial = {
  base: standard("#9b5d2d", 0.9),
  bed: standard("#d69a4e", 0.94),
  post: standard("#b97836", 0.92),
  topRail: standard("#e0a65a", 0.9),
  rail: standard("#c7853d", 0.9),
  grip: standard("#8d5228", 0.78),
  stay: standard("#d99d52", 0.84),
};

export const HarvestBasket = forwardRef<THREE.Group, { carry: CarryState }>(function HarvestBasket({ carry }, ref) {
  if (!carryTotal(carry)) return null;
  const visibleProducts = carriedProductIds(carry)
    .flatMap((productId) => Array.from({ length: carryQuantity(carry, productId) }, () => productId))
    .slice(0, MAX_WAREHOUSE_PICKUP_BATCH);

  return <group ref={ref} name="HarvestBasket">
    <mesh geometry={basketGeometry.base} material={basketMaterial.base} position={[0, -0.13, 0]} castShadow />
    <mesh geometry={basketGeometry.bed} material={basketMaterial.bed} position={[0, -0.045, 0]} />
    {[-0.19, 0, 0.19].map((x) => <mesh key={`front-${x}`} geometry={basketGeometry.post} material={basketMaterial.post} position={[x, -0.025, 0.185]} castShadow />)}
    {[-0.09, 0.02, 0.13].map((y) => <mesh key={`front-row-${y}`} geometry={basketGeometry.frontRail} material={y === 0.13 ? basketMaterial.topRail : basketMaterial.rail} position={[0, y, 0.19]} castShadow />)}
    {[-1, 1].flatMap((side) => [-0.09, 0.02, 0.13].map((y) => <mesh key={`side-${side}-${y}`} geometry={basketGeometry.sideRail} material={y === 0.13 ? basketMaterial.topRail : basketMaterial.rail} position={[side * 0.305, y, 0]} castShadow />))}
    <group name="HarvestBasketAdaptiveHandle">
      <mesh name="BasketGripBar" geometry={basketGeometry.gripBar} material={basketMaterial.grip} castShadow />
      {[-1, 1].map((side) => <group key={`grip-${side}`}>
        <mesh name={side < 0 ? "BasketHandleStayLeft" : "BasketHandleStayRight"} geometry={basketGeometry.stay} material={basketMaterial.stay} castShadow />
        <mesh name={side < 0 ? "BasketGripLeft" : "BasketGripRight"} geometry={basketGeometry.grip} material={basketMaterial.grip} castShadow />
      </group>)}
    </group>
    <group position={[0, 0.08, 0]}>
      {visibleProducts.map((productId, index) => {
        const column = index % 4;
        const depth = Math.floor(index / 4) % 2;
        const layer = Math.floor(index / 8);
        return <BasketProduct
          key={`${productId}-${index}`}
          productId={productId}
          position={[(column - 1.5) * 0.13, layer * 0.105, (depth - 0.5) * 0.13]}
          rotation={[0, (index * 1.71) % Math.PI, index % 2 ? -0.08 : 0.08]}
          scale={0.78}
        />;
      })}
    </group>
  </group>;
});

// Shared geometry and material per product part. A magnet burst mounts up to
// twenty units in one commit; sharing keeps that to a few mesh objects per
// unit instead of new geometry buffers, GPU uploads and material programs.
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

export function BasketProduct({ productId, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 }: { productId: ProductId; position?: [number, number, number]; rotation?: [number, number, number]; scale?: number }) {
  if (productId === "cannedCorn") return <CannedCornModel position={position} rotation={rotation} scale={scale} />;
  const delivered = deliveredProductId(productId);
  if (delivered) return <DeliveredModel id={delivered} position={position} rotation={rotation} scale={scale * 0.8} />;
  if (productId === "oranges") return <mesh castShadow position={position} rotation={rotation} scale={scale} geometry={productGeometry.orange} material={productMaterial.orange} />;
  if (productId === "tomatoes" || productId === "apples") {
    const tomato = productId === "tomatoes";
    return <group position={position} rotation={rotation} scale={scale}>
      <mesh castShadow scale={tomato ? [1, 0.86, 1] : [0.9, 1, 0.9]} geometry={productGeometry.fruit} material={tomato ? productMaterial.tomato : productMaterial.apple} />
      <mesh position={[0, 0.075, 0]} rotation={[0, 0, Math.PI]} geometry={tomato ? productGeometry.tomatoCrown : productGeometry.appleCrown} material={productMaterial.crown} />
    </group>;
  }
  if (productId === "corn") return <group position={position} rotation={[rotation[0], rotation[1], rotation[2] + 0.16]} scale={scale}>
    <mesh castShadow scale={[0.68, 1.28, 0.68]} geometry={productGeometry.cornBody} material={productMaterial.corn} />
    {[-1, 1].map((side) => <mesh key={side} position={[side * 0.048, -0.015, 0]} rotation={[0, 0, side * 0.48]} scale={[0.44, 1.1, 0.32]} geometry={productGeometry.cornHusk} material={productMaterial.husk} />)}
  </group>;
  if (productId === "wheat") return <group position={position} rotation={rotation} scale={scale}>
    {[-0.045, 0, 0.045].map((x, index) => <group key={x} position={[x, 0, (index - 1) * 0.012]} rotation={[0, 0, (index - 1) * 0.1]}>
      <mesh position={[0, 0.04, 0]} geometry={productGeometry.wheatStem} material={productMaterial.wheatStem} />
      <mesh position={[0, 0.145, 0]} scale={[0.65, 1.25, 0.65]} geometry={productGeometry.wheatHead} material={productMaterial.wheatHead} />
    </group>)}
  </group>;
  if (productId === "eggs") return <mesh castShadow position={position} rotation={rotation} scale={[0.72 * scale, 1.02 * scale, 0.72 * scale]} geometry={productGeometry.egg} material={productMaterial.egg} />;
  if (productId === "milk" || productId === "juice") return <group position={position} rotation={rotation} scale={scale}>
    <mesh castShadow geometry={productGeometry.bottle} material={productId === "milk" ? productMaterial.milk : productMaterial.juice} />
    <mesh position={[0, 0.108, 0]} geometry={productGeometry.bottleCap} material={productId === "milk" ? productMaterial.milkCap : productMaterial.juiceCap} />
  </group>;
  if (productId === "cheese") return <mesh castShadow position={position} rotation={[rotation[0], rotation[1], rotation[2] + Math.PI / 2]} scale={scale} geometry={productGeometry.cheese} material={productMaterial.cheese} />;
  if (productId === "bread") return <mesh castShadow position={position} rotation={rotation} scale={scale} geometry={productGeometry.bread} material={productMaterial.bread} />;
  const packMaterial = productId === "coffee" ? productMaterial.coffee : productId === "flour" ? productMaterial.flour : productMaterial.pack;
  return <mesh castShadow position={position} rotation={rotation} scale={scale} geometry={productGeometry.pack} material={packMaterial} />;
}
