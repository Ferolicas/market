"use client";

import { RoundedBox } from "@react-three/drei";
import { forwardRef } from "react";
import * as THREE from "three";
import type { CarryState, ProductId } from "@/game/types";
import { carriedProductIds, carryQuantity, carryTotal } from "@/game/player/CarrySystem";
import { HARVEST_BASKET_GRIP_HALF_WIDTH, HARVEST_BASKET_GRIP_HEIGHT, HARVEST_BASKET_GRIP_REACH } from "@/game/animation/CarrySocket";

export const HarvestBasket = forwardRef<THREE.Group, { carry: CarryState }>(function HarvestBasket({ carry }, ref) {
  if (!carryTotal(carry)) return null;
  const visibleProducts = carriedProductIds(carry)
    .flatMap((productId) => Array.from({ length: carryQuantity(carry, productId) }, () => productId))
    .slice(0, 12);

  return <group ref={ref} name="HarvestBasket">
    <RoundedBox args={[0.62, 0.14, 0.36]} position={[0, -0.13, 0]} radius={0.055} smoothness={3} castShadow>
      <meshStandardMaterial color="#9b5d2d" roughness={0.9} />
    </RoundedBox>
    <RoundedBox args={[0.55, 0.08, 0.29]} position={[0, -0.045, 0]} radius={0.045} smoothness={3}>
      <meshStandardMaterial color="#d69a4e" roughness={0.94} />
    </RoundedBox>
    {[-0.19, 0, 0.19].map((x) => <RoundedBox key={`front-${x}`} args={[0.055, 0.25, 0.035]} position={[x, -0.025, 0.185]} radius={0.014} smoothness={2} castShadow>
      <meshStandardMaterial color="#b97836" roughness={0.92} />
    </RoundedBox>)}
    {[-0.09, 0.02, 0.13].map((y) => <RoundedBox key={`front-row-${y}`} args={[0.61, 0.035, 0.035]} position={[0, y, 0.19]} radius={0.012} smoothness={2} castShadow>
      <meshStandardMaterial color={y === 0.13 ? "#e0a65a" : "#c7853d"} roughness={0.9} />
    </RoundedBox>)}
    {[-1, 1].flatMap((side) => [-0.09, 0.02, 0.13].map((y) => <RoundedBox key={`side-${side}-${y}`} args={[0.035, 0.035, 0.35]} position={[side * 0.305, y, 0]} radius={0.012} smoothness={2} castShadow>
      <meshStandardMaterial color={y === 0.13 ? "#e0a65a" : "#c7853d"} roughness={0.9} />
    </RoundedBox>))}
    <mesh position={[0, 0.14, 0]} castShadow>
      <torusGeometry args={[0.285, 0.022, 8, 28, Math.PI]} />
      <meshStandardMaterial color="#e3ad68" roughness={0.88} />
    </mesh>
    {[-1, 1].map((side) => <group key={`grip-${side}`} name={side < 0 ? "BasketGripLeft" : "BasketGripRight"}>
      <mesh position={[side * HARVEST_BASKET_GRIP_HALF_WIDTH, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.023, 0.023, HARVEST_BASKET_GRIP_REACH, 10]} />
        <meshStandardMaterial color="#d99d52" roughness={0.84} />
      </mesh>
      <mesh position={[side * HARVEST_BASKET_GRIP_HALF_WIDTH, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH]} castShadow>
        <sphereGeometry args={[0.037, 12, 8]} />
        <meshStandardMaterial color="#8d5228" roughness={0.78} />
      </mesh>
    </group>)}
    <group position={[0, 0.08, 0]}>
      {visibleProducts.map((productId, index) => {
        const column = index % 3;
        const row = Math.floor(index / 3);
        return <BasketProduct
          key={`${productId}-${index}`}
          productId={productId}
          position={[(column - 1) * 0.15, row * 0.085, (row % 2 ? -1 : 1) * 0.055]}
          rotation={[0, (index * 1.71) % Math.PI, index % 2 ? -0.08 : 0.08]}
          scale={0.78}
        />;
      })}
    </group>
  </group>;
});

export function BasketProduct({ productId, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 }: { productId: ProductId; position?: [number, number, number]; rotation?: [number, number, number]; scale?: number }) {
  if (productId === "tomatoes" || productId === "apples") {
    const tomato = productId === "tomatoes";
    return <group position={position} rotation={rotation} scale={scale}>
      <mesh castShadow scale={tomato ? [1, 0.86, 1] : [0.9, 1, 0.9]}>
        <sphereGeometry args={[0.085, 12, 8]} />
        <meshStandardMaterial color={tomato ? "#df4438" : "#bd3432"} roughness={0.76} />
      </mesh>
      <mesh position={[0, 0.075, 0]} rotation={[0, 0, Math.PI]}>
        <coneGeometry args={[0.045, tomato ? 0.038 : 0.055, 5]} />
        <meshStandardMaterial color="#3f7f3d" roughness={0.9} />
      </mesh>
    </group>;
  }
  if (productId === "corn") return <group position={position} rotation={[rotation[0], rotation[1], rotation[2] + 0.16]} scale={scale}>
    <mesh castShadow scale={[0.68, 1.28, 0.68]}><sphereGeometry args={[0.067, 12, 8]} /><meshStandardMaterial color="#f2c43d" roughness={0.82} /></mesh>
    {[-1, 1].map((side) => <mesh key={side} position={[side * 0.048, -0.015, 0]} rotation={[0, 0, side * 0.48]} scale={[0.44, 1.1, 0.32]}><sphereGeometry args={[0.075, 8, 6]} /><meshStandardMaterial color="#639848" roughness={0.95} /></mesh>)}
  </group>;
  if (productId === "wheat") return <group position={position} rotation={rotation} scale={scale}>
    {[-0.045, 0, 0.045].map((x, index) => <group key={x} position={[x, 0, (index - 1) * 0.012]} rotation={[0, 0, (index - 1) * 0.1]}>
      <mesh position={[0, 0.04, 0]}><cylinderGeometry args={[0.009, 0.012, 0.18, 6]} /><meshStandardMaterial color="#d9a733" roughness={0.92} /></mesh>
      <mesh position={[0, 0.145, 0]} scale={[0.65, 1.25, 0.65]}><sphereGeometry args={[0.035, 8, 6]} /><meshStandardMaterial color="#edbf45" roughness={0.88} /></mesh>
    </group>)}
  </group>;
  if (productId === "eggs") return <mesh castShadow position={position} rotation={rotation} scale={[0.72 * scale, 1.02 * scale, 0.72 * scale]}><sphereGeometry args={[0.072, 12, 8]} /><meshStandardMaterial color="#f5ead1" roughness={0.92} /></mesh>;
  if (productId === "milk" || productId === "juice") return <group position={position} rotation={rotation} scale={scale}>
    <mesh castShadow><cylinderGeometry args={[0.045, 0.052, 0.18, 9]} /><meshStandardMaterial color={productId === "milk" ? "#f7f3e9" : "#ed8442"} roughness={0.58} /></mesh>
    <mesh position={[0, 0.108, 0]}><cylinderGeometry args={[0.023, 0.027, 0.04, 8]} /><meshStandardMaterial color={productId === "milk" ? "#4e91bc" : "#438653"} /></mesh>
  </group>;
  if (productId === "cheese") return <mesh castShadow position={position} rotation={[rotation[0], rotation[1], rotation[2] + Math.PI / 2]} scale={scale}><cylinderGeometry args={[0.085, 0.085, 0.105, 3]} /><meshStandardMaterial color="#efbd3d" roughness={0.78} /></mesh>;
  if (productId === "bread") return <RoundedBox args={[0.17, 0.13, 0.12]} position={position} rotation={rotation} scale={scale} radius={0.05} smoothness={3} castShadow><meshStandardMaterial color="#b87338" roughness={0.9} /></RoundedBox>;
  const color = productId === "coffee" ? "#704333" : productId === "flour" ? "#efe3c9" : "#d7af48";
  return <RoundedBox args={[0.14, 0.18, 0.1]} position={position} rotation={rotation} scale={scale} radius={0.018} smoothness={2} castShadow><meshStandardMaterial color={color} roughness={0.86} /></RoundedBox>;
}
