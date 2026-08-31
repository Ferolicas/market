"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { forwardRef, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { dampFactor, frameDelta, turnTowards, type VisitorAnimation } from "@/game/locomotion";
import type { CustomerRuntimeState, ProductId } from "@/game/types";
import { scaleStorePoint, STORE_LAYOUT_SCALE } from "@/game/world-scale";
import { FacialController, type FaceExpression } from "@/game/animation/FacialController";
import { captureCustomerMotion, projectCustomerMotion } from "@/game/animation/CustomerVisualMotion";

export type CustomerId = 1 | 2 | 3 | 4 | 5 | 6;
type CustomerAnimation = VisitorAnimation;

const MODEL_PATHS: Record<CustomerId, string> = {
  1: "/models/market/customers/customer_01_man_young.glb",
  2: "/models/market/customers/customer_02_man_senior.glb",
  3: "/models/market/customers/customer_03_woman_young.glb",
  4: "/models/market/customers/customer_04_woman_adult.glb",
  5: "/models/market/customers/customer_05_woman_mature.glb",
  6: "/models/market/customers/customer_06_woman_senior.glb",
};

const LOD1_PATHS = Object.fromEntries(Object.entries(MODEL_PATHS).map(([id, path]) => [id, path.replace("/customers/", "/customers/lod1/")])) as Record<CustomerId, string>;
const CUSTOMER_SCALE: Record<CustomerId, number> = { 1: 1.29, 2: 1.28, 3: 1.32, 4: 1.32, 5: 1.32, 6: 1.27 };

export function Customer({ customer, simulationTimeMs }: { customer: CustomerRuntimeState; simulationTimeMs: number }) {
  const id = customer.identity;
  const root = useRef<THREE.Group>(null);
  const characterRoot = useRef<THREE.Group>(null);
  const carrySocket = useRef<THREE.Group>(null);
  const initialPosition = scaleStorePoint([customer.x, customer.z]);
  const cart = useRef<THREE.Group>(null);
  const bag = useRef<THREE.Group>(null);
  const activeAnimation = useRef<CustomerAnimation>("Idle");
  const visualGaitScale = useRef(1);
  const visualFrame = useRef(0);
  const stableHeadQuaternion = useRef(new THREE.Quaternion());
  const desiredHeadQuaternion = useRef(new THREE.Quaternion());
  const carryWorldPosition = useRef(new THREE.Vector3());
  const carryLocalPosition = useRef(new THREE.Vector3());
  const carryObjectWorldPosition = useRef(new THREE.Vector3());
  const headInitialized = useRef(false);
  const facial = useRef(new FacialController(customer.identity * 97));
  const motionSnapshot = useRef(captureCustomerMotion(customer, nowMs()));
  const refreshMotionSnapshot = useEffectEvent(() => {
    motionSnapshot.current = captureCustomerMotion(customer, nowMs());
  });
  // An orthographic camera does not make a character smaller as its world
  // distance changes, so distance-based LOD was both visually inconsistent
  // and forced all three GLBs to decode up front. Pick one appropriate source
  // for the viewport and keep the highest-detail model on desktop/GPU play.
  const [compactModel] = useState(() => typeof window !== "undefined" && window.innerWidth <= 640);
  const gltf = useGLTF(compactModel ? LOD1_PATHS[id] : MODEL_PATHS[id]);
  const model = useMemo(() => prepareModel(gltf.scene), [gltf.scene]);
  const { actions } = useAnimations(gltf.animations, model);
  const morphMeshes = useMemo(() => collectMorphMeshes(model), [model]);
  const carryHand = useMemo(() => model.getObjectByName("Hand_L"), [model]);
  const head = useMemo(() => model.getObjectByName("Head"), [model]);

  useEffect(() => {
    actions.Idle?.reset().play();
    return () => {
      Object.values(actions).forEach((action) => action?.stop());
      const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
      const visuals = qaWindow.__MARKET_QA__?.customerVisuals as Record<string, unknown> | undefined;
      if (visuals) delete visuals[customer.id];
    };
  }, [actions, customer.id]);

  useEffect(() => () => {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }, [model]);

  useEffect(() => {
    // Game actions clone the complete save even when they only record player
    // progression. Refreshing from the customer object identity made every
    // walked metre restart visual extrapolation from the previous world tick.
    // The simulation clock (plus a real FSM transition) is the authoritative
    // signal that customer locomotion may have changed.
    refreshMotionSnapshot();
  }, [customer.id, customer.state, simulationTimeMs]);

  useFrame(({ clock }, delta) => {
    visualFrame.current += 1;
    const group = root.current;
    if (!group) return;
    const projected = projectCustomerMotion(motionSnapshot.current, nowMs());
    const [x, z] = scaleStorePoint([projected.x, projected.z]);
    const animation = customerAnimation(customer, clock.elapsedTime);

    const expression: FaceExpression = animation === "Happy" || animation === "ReceiveBag" ? "Happy" : animation === "Confused" ? "Confused" : animation === "Impatient" || customer.state === "WAIT_RESTOCK" || customer.angry ? "Impatient" : "Neutral";
    const weights = facial.current.weights(clock.elapsedTime + id * 0.21, expression);
    const focus = animation === "Browse" || animation === "ReachShelf" || animation === "CheckoutItem" ? 0.22 : 0;
    for (const mesh of morphMeshes) {
      const dictionary = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dictionary || !influences) continue;
      for (const name of ["Blink_L", "Blink_R", "EyeWide_L", "EyeWide_R", "BrowUp_L", "BrowUp_R", "BrowDown_L", "BrowDown_R", "Smile", "CheekUp", "Frown", "JawOpen", "MouthNarrow", "Surprise", "Confused"]) setMorph(dictionary, influences, name, weights[name] ?? 0);
      if (focus) { setMorph(dictionary, influences, "BrowDown_L", focus); setMorph(dictionary, influences, "BrowDown_R", focus); }
    }
    if (head) {
      desiredHeadQuaternion.current.copy(head.quaternion);
      if (!headInitialized.current) {
        stableHeadQuaternion.current.copy(desiredHeadQuaternion.current);
        headInitialized.current = true;
      } else {
        stableHeadQuaternion.current.rotateTowards(desiredHeadQuaternion.current, frameDelta(delta) * 1.8);
      }
      head.quaternion.copy(stableHeadQuaternion.current);
    }
    group.visible = customer.state !== "DESPAWN";
    const previousX = group.position.x; const previousZ = group.position.z;
    // The projected point is already the continuous interpolation of the
    // authoritative NavMesh path. Smoothing it again makes the body trail the
    // route and produces a visible stop/start pulse at snapshot boundaries.
    group.position.x = x;
    group.position.z = z;
    const visualSpeed = Math.hypot(group.position.x - previousX, group.position.z - previousZ) / Math.max(0.001, frameDelta(delta)) / STORE_LAYOUT_SCALE;
    if (Math.hypot(projected.headingX, projected.headingZ) > 0.5) {
      const angle = Math.atan2(projected.headingX, projected.headingZ);
      group.rotation.y = turnTowards(group.rotation.y, angle, frameDelta(delta) * 2.9);
    }
    if (characterRoot.current && carrySocket.current && carryHand) {
      characterRoot.current.updateWorldMatrix(true, false);
      carryHand.updateWorldMatrix(true, false);
      carryHand.getWorldPosition(carryWorldPosition.current);
      characterRoot.current.worldToLocal(carryLocalPosition.current.copy(carryWorldPosition.current));
      carrySocket.current.position.copy(carryLocalPosition.current);
    }
    if (cart.current) cart.current.visible = customer.hasCart;
    if (bag.current) bag.current.visible = customer.hasBag && !customer.hasCart;
    const locomotion = animation === "Enter" || animation === "Exit" || animation === "Walk" || animation === "CarryBasket";
    const targetGaitScale = locomotion ? THREE.MathUtils.clamp(visualSpeed * 2 / (0.72 * CUSTOMER_SCALE[id]), 0.8, 2.8) : 1;
    visualGaitScale.current = THREE.MathUtils.lerp(visualGaitScale.current, targetGaitScale, dampFactor(9, delta));
    if (animation !== activeAnimation.current) {
      actions[activeAnimation.current]?.fadeOut(0.26);
      actions[animation]?.reset().setEffectiveTimeScale(visualGaitScale.current).fadeIn(0.26).play();
      activeAnimation.current = animation;
    }
    actions[animation]?.setEffectiveTimeScale(visualGaitScale.current);

    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    if (qaWindow.__MARKET_QA__) {
      const visuals = (qaWindow.__MARKET_QA__.customerVisuals ??= {}) as Record<string, unknown>;
      let cartDistance: number | null = null;
      if (cart.current?.visible) {
        cart.current.getWorldPosition(carryObjectWorldPosition.current);
        cartDistance = group.position.distanceTo(carryObjectWorldPosition.current);
      }
      visuals[customer.id] = {
        visualFrame: visualFrame.current,
        state: customer.state,
        animation,
        x: group.position.x,
        z: group.position.z,
        speed: motionSnapshot.current.speed,
        snapshotCapturedAtMs: motionSnapshot.current.capturedAtMs,
        headQuaternion: head?.quaternion.toArray() ?? null,
        cartVisible: cart.current?.visible ?? false,
        cartDistance,
        bagVisible: bag.current?.visible ?? false,
      };
    }
  });

  return <group ref={root} position={[initialPosition[0], 0, initialPosition[1]]}>
    <group ref={characterRoot} scale={CUSTOMER_SCALE[id]}>
      <GroundingShadow />
      <primitive object={model} dispose={null} />
      <group ref={carrySocket}><CustomerBag ref={bag} /></group>
    </group>
    <CustomerCart ref={cart} inventory={customer.basket} bagged={customer.hasBag} />
  </group>;
}

function prepareModel(source: THREE.Group) {
  const copy = clone(source) as THREE.Group;
  copy.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    // Crowds already have a stable contact blob. Casting every skinned
    // primitive into the store's shadow map multiplies draw calls by roughly
    // three at the 30-customer target, without a visible gain at isometric
    // scale. Geometry stays shared, while mutable materials, morph weights and
    // skeleton state remain instance-local so one visitor cannot alter another.
    object.castShadow = false;
    object.receiveShadow = true;
    object.frustumCulled = false;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || !material.map) continue;
      // The PNG-derived atlas already contains soft studio shading. A small
      // self-lit contribution preserves those authored colours in the much
      // wider store scene instead of multiplying the shadows a second time.
      material.emissiveMap = material.map;
      material.emissive.set("#ffffff");
      material.emissiveIntensity = 0.24;
      material.roughness = Math.max(material.roughness, 0.78);
      material.envMapIntensity = 0.64;
      material.needsUpdate = true;
    }
  });
  return copy;
}

function collectMorphMeshes(model: THREE.Group) {
  const meshes: THREE.Mesh[] = [];
  model.traverse((object) => {
    if (object instanceof THREE.Mesh && object.morphTargetDictionary && object.morphTargetInfluences) meshes.push(object);
  });
  return meshes;
}

function customerAnimation(customer: CustomerRuntimeState, elapsed = 0): CustomerAnimation {
  switch (customer.state) {
    case "ENTER_STORE": return "Enter";
    case "NAVIGATE_TO_PRODUCT": return "CarryBasket";
    case "NAVIGATE_TO_QUEUE":
    case "MOVE_QUEUE": return "CarryBasket";
    case "WAIT_FOR_ACCESS": return "Browse";
    case "PICK_PRODUCT": return "ReachShelf";
    case "QUEUE_WAIT": {
      const phase = (elapsed + customer.identity * 2.31) % 18;
      if (phase < 8) return "Queue";
      if (phase < 11) return "Wait";
      if (phase < 13) return "Phone";
      if (phase < 15.5) return "Queue";
      if (phase < 17) return "Impatient";
      return "Talk";
    }
    case "UNLOAD": return "CheckoutItem";
    case "WAIT_CHECKOUT": return customer.identity % 3 === 0 ? "Confused" : customer.identity % 2 ? "Wait" : "Queue";
    case "PAY": return "Pay";
    case "NAVIGATE_TO_BAG": return "Walk";
    case "TAKE_BAG": return "ReceiveBag";
    case "NAVIGATE_TO_RETURNS": return "CarryBasket";
    case "LEAVE_RETURNS": return "CheckoutItem";
    case "NAVIGATE_TO_CART_RETURN": return "CarryBasket";
    case "RETURN_CART": return "CheckoutItem";
    case "EXIT_STORE": return "Exit";
    case "WAIT_RESTOCK": return "Confused";
    case "GET_CART": return "ReachShelf";
    default: return "Idle";
  }
}

function setMorph(dictionary: Record<string, number>, influences: number[], name: string, value: number) {
  const index = dictionary[name];
  if (index !== undefined) influences[index] = value;
}

function GroundingShadow() {
  return <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.58, 0.34, 1]} renderOrder={-1}>
    <circleGeometry args={[1, 24]} />
    <meshBasicMaterial color="#15251f" transparent opacity={0.2} depthWrite={false} />
  </mesh>;
}

const CART_PRODUCT_COLORS: Record<ProductId, string> = { wheat: "#d7af48", flour: "#eee2c8", bread: "#ad6d35", corn: "#e6bc43", milk: "#f4f0df", eggs: "#eee4c8", cheese: "#e8b94b", apples: "#c94f3e", tomatoes: "#d6503e", coffee: "#6b4031", juice: "#d96842" };

const CustomerCart = forwardRef<THREE.Group, { inventory: CustomerRuntimeState["basket"]; bagged: boolean }>(function CustomerCart({ inventory, bagged }, ref) {
  const units = (Object.entries(inventory) as [ProductId, number][]).flatMap(([productId, quantity]) => Array.from({ length: Math.min(quantity, 3) }, () => productId)).slice(0, 8);
  return <group ref={ref} position={[0, 0, 0.8]} scale={0.92} visible={false}>
    <mesh position={[0, 0.72, -0.36]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.035, 0.035, 0.92, 10]} /><meshStandardMaterial color="#52734a" roughness={0.55} /></mesh>
    <mesh position={[0, 0.54, 0.02]}><boxGeometry args={[0.78, 0.48, 0.72]} /><meshStandardMaterial color="#9aa5a2" transparent opacity={0.28} metalness={0.42} roughness={0.34} /></mesh>
    {[-0.39, 0.39].map((x) => <mesh key={`side-${x}`} position={[x, 0.54, 0.02]}><boxGeometry args={[0.035, 0.5, 0.75]} /><meshStandardMaterial color="#75837f" metalness={0.58} roughness={0.32} /></mesh>)}
    {[-0.32, -0.1, 0.12, 0.34].map((x) => <mesh key={`rail-${x}`} position={[x, 0.54, 0.02]}><boxGeometry args={[0.025, 0.5, 0.74]} /><meshStandardMaterial color="#75837f" metalness={0.58} roughness={0.32} /></mesh>)}
    <mesh position={[0, 0.25, -0.17]} rotation={[-0.12, 0, 0]}><boxGeometry args={[0.72, 0.06, 0.5]} /><meshStandardMaterial color="#7c8985" metalness={0.5} roughness={0.4} /></mesh>
    {[-0.31, 0.31].map((x) => <mesh key={`leg-${x}`} position={[x, 0.2, -0.22]} rotation={[0, 0, x < 0 ? -0.1 : 0.1]}><boxGeometry args={[0.045, 0.48, 0.045]} /><meshStandardMaterial color="#68736f" metalness={0.55} roughness={0.38} /></mesh>)}
    {[-0.3, 0.3].flatMap((x) => [-0.25, 0.24].map((z) => <mesh key={`wheel-${x}-${z}`} position={[x, 0.075, z]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.075, 0.075, 0.055, 12]} /><meshStandardMaterial color="#252c2a" roughness={0.86} /></mesh>))}
    {units.map((productId, index) => <mesh key={`${productId}-${index}`} position={[(index % 3 - 1) * 0.19, 0.42 + Math.floor(index / 3) * 0.15, 0.03 + (index % 2) * 0.13]}>
      {productId === "tomatoes" || productId === "apples" || productId === "eggs" ? <dodecahedronGeometry args={[0.085, 1]} /> : <boxGeometry args={[0.15, 0.13, 0.14]} />}
      <meshStandardMaterial color={CART_PRODUCT_COLORS[productId]} roughness={0.76} />
    </mesh>)}
    {bagged && <group position={[0, 0.5, 0.02]}><mesh><boxGeometry args={[0.4, 0.48, 0.28]} /><meshStandardMaterial color="#bd8550" roughness={0.92} /></mesh><mesh position={[0, 0.28, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.13, 0.018, 6, 12, Math.PI]} /><meshStandardMaterial color="#8c5e38" /></mesh></group>}
  </group>;
});

const CustomerBag = forwardRef<THREE.Group>(function CustomerBag(_, ref) {
  return <group ref={ref} position={[0, -0.28, 0.08]} rotation={[0.03, 0, 0.03]} visible={false}>
    <mesh><boxGeometry args={[0.42, 0.5, 0.26]} /><meshStandardMaterial color="#bd8550" roughness={0.92} /></mesh>
    <mesh position={[0, 0.29, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.13, 0.018, 6, 12, Math.PI]} /><meshStandardMaterial color="#8c5e38" /></mesh>
  </group>;
});

function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
