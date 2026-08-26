"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { forwardRef, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

export type CustomerId = 1 | 2 | 3 | 4 | 5 | 6;
type CustomerAnimation = "Idle" | "Walk" | "Enter" | "Wait" | "Browse" | "ReachShelf" | "CarryBasket" | "Queue" | "CheckoutItem" | "Pay" | "ReceiveBag" | "Confused" | "Happy" | "Exit";

const MODEL_PATHS: Record<CustomerId, string> = {
  1: "/models/customer1_kit_v1.glb",
  2: "/models/customer2_kit_v1.glb",
  3: "/models/customer3_kit_v1.glb",
  4: "/models/customer4_kit_v1.glb",
  5: "/models/customer5_kit_v1.glb",
  6: "/models/customer6_kit_v1.glb",
};

const CUSTOMER_SCALE: Record<CustomerId, number> = { 1: 0.77, 2: 0.73, 3: 0.76, 4: 0.75, 5: 0.74, 6: 0.7 };

const ROUTES: Record<CustomerId, { browse: [number, number]; queue: [number, number] }> = {
  1: { browse: [-2.7, -0.1], queue: [3.45, 3.45] },
  2: { browse: [0, -2.15], queue: [3.2, 3.65] },
  3: { browse: [2.65, -0.15], queue: [2.95, 3.85] },
  4: { browse: [-2.2, 2.75], queue: [2.7, 4.05] },
  5: { browse: [0.35, 2.75], queue: [2.45, 4.25] },
  6: { browse: [2.75, 2.7], queue: [2.2, 4.45] },
};

export function Customer({ id, offset = 0 }: { id: CustomerId; offset?: number }) {
  const root = useRef<THREE.Group>(null);
  const basket = useRef<THREE.Group>(null);
  const bag = useRef<THREE.Group>(null);
  const activeAnimation = useRef<CustomerAnimation>("Idle");
  const gltf = useGLTF(MODEL_PATHS[id]);
  const model = useMemo(() => {
    const copy = clone(gltf.scene) as THREE.Group;
    copy.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = true;
      object.material = Array.isArray(object.material) ? object.material.map((material) => material.clone()) : object.material.clone();
    });
    return copy;
  }, [gltf.scene]);
  const { actions } = useAnimations(gltf.animations, model);
  const route = ROUTES[id];

  useEffect(() => {
    actions.Idle?.reset().play();
    return () => {
      Object.values(actions).forEach((action) => action?.stop());
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
    };
  }, [actions, model]);

  useFrame(({ clock }) => {
    const group = root.current;
    if (!group) return;
    const time = (clock.elapsedTime + offset) % 36;
    const entryX = id % 2 ? -1.0 : 1.0;
    let animation: CustomerAnimation = "Idle";
    let x = entryX;
    let z = 5.25;
    let targetX = x;
    let targetZ = z - 1;

    if (time < 5) {
      const progress = smooth(time / 5);
      x = THREE.MathUtils.lerp(entryX, route.browse[0], progress);
      z = THREE.MathUtils.lerp(5.25, route.browse[1], progress);
      targetX = route.browse[0]; targetZ = route.browse[1]; animation = "Enter";
    } else if (time < 10) {
      [x, z] = route.browse; targetX = x + (id % 2 ? -1 : 1); targetZ = z; animation = "Browse";
    } else if (time < 14) {
      [x, z] = route.browse; targetX = x + (id % 2 ? -1 : 1); targetZ = z; animation = "ReachShelf";
    } else if (time < 21) {
      const progress = smooth((time - 14) / 7);
      x = THREE.MathUtils.lerp(route.browse[0], route.queue[0], progress);
      z = THREE.MathUtils.lerp(route.browse[1], route.queue[1], progress);
      targetX = route.queue[0]; targetZ = route.queue[1]; animation = progress < 0.35 ? "Walk" : "CarryBasket";
    } else if (time < 25) {
      [x, z] = route.queue; targetX = 5.15; targetZ = 3.5; animation = id % 3 === 0 ? "Confused" : "Queue";
    } else if (time < 28) {
      x = 4.15; z = 3.55; targetX = 5.2; targetZ = 3.5; animation = "CheckoutItem";
    } else if (time < 30) {
      x = 4.15; z = 3.55; targetX = 5.2; targetZ = 3.5; animation = "Pay";
    } else if (time < 32) {
      x = 4.15; z = 3.55; targetX = 5.2; targetZ = 3.5; animation = "ReceiveBag";
    } else {
      const progress = smooth((time - 32) / 4);
      x = THREE.MathUtils.lerp(4.15, entryX, progress);
      z = THREE.MathUtils.lerp(3.55, 5.7, progress);
      targetX = entryX; targetZ = 6.2; animation = "Exit";
    }

    group.position.set(x, 0, z);
    const angle = Math.atan2(targetX - x, targetZ - z);
    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, angle, 0.16);
    if (basket.current) basket.current.visible = animation === "CarryBasket" || animation === "Queue";
    if (bag.current) bag.current.visible = animation === "ReceiveBag" || animation === "Exit";
    if (animation !== activeAnimation.current) {
      actions[activeAnimation.current]?.fadeOut(0.18);
      actions[animation]?.reset().fadeIn(0.18).play();
      activeAnimation.current = animation;
    }
  });

  return <group ref={root}>
    <group scale={CUSTOMER_SCALE[id]}><primitive object={model} dispose={null} /></group>
    <CustomerBasket ref={basket} />
    <CustomerBag ref={bag} />
  </group>;
}

const CustomerBasket = forwardRef<THREE.Group>(function CustomerBasket(_, ref) {
  return <group ref={ref} position={[0, 0.78, 0.42]} visible={false}>
    <mesh castShadow><boxGeometry args={[0.52, 0.3, 0.34]} /><meshStandardMaterial color="#526e3f" roughness={0.78} /></mesh>
    <mesh position={[-0.16, 0.29, 0]} rotation={[0, 0, -0.42]}><torusGeometry args={[0.22, 0.025, 6, 14, Math.PI]} /><meshStandardMaterial color="#27382b" /></mesh>
    <mesh position={[0.16, 0.29, 0]} rotation={[0, 0, 0.42]}><torusGeometry args={[0.22, 0.025, 6, 14, Math.PI]} /><meshStandardMaterial color="#27382b" /></mesh>
    {[[-0.15, "#d8694d"], [0, "#e0b44a"], [0.15, "#76a854"]].map(([x, color]) => <mesh key={String(x)} position={[Number(x), 0.22, 0]} castShadow><dodecahedronGeometry args={[0.09, 0]} /><meshStandardMaterial color={String(color)} /></mesh>)}
  </group>;
});

const CustomerBag = forwardRef<THREE.Group>(function CustomerBag(_, ref) {
  return <group ref={ref} position={[0.2, 0.72, 0.36]} visible={false}>
    <mesh castShadow><boxGeometry args={[0.42, 0.5, 0.26]} /><meshStandardMaterial color="#bd8550" roughness={0.92} /></mesh>
    <mesh position={[0, 0.29, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.13, 0.018, 6, 12, Math.PI]} /><meshStandardMaterial color="#8c5e38" /></mesh>
  </group>;
});

function smooth(value: number) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
