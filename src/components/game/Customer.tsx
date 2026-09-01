"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { forwardRef, useEffect, useEffectEvent, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { dampFactor, frameDelta, turnTowards, type VisitorAnimation } from "@/game/locomotion";
import type { CheckoutTransaction, CustomerRuntimeState, ProductId } from "@/game/types";
import { scaleStorePoint, STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE, WORLD_SCALE } from "@/game/world-scale";
import { FacialController, type FaceExpression } from "@/game/animation/FacialController";
import { disposeCharacterMaterials, prepareCharacterModel } from "@/game/animation/CharacterPresentation";
import { captureCustomerMotion, projectCustomerMotion } from "@/game/animation/CustomerVisualMotion";
import { CUSTOMER_CART_WHEEL_RADIUS, CUSTOMER_CHECKOUT_ITEM_CYCLE_MS, CUSTOMER_PICKUP_DURATION_MS, cartSteeringAngle, checkoutCartInventory, checkoutLoadingPresentation, easedMotionProgress, motionProgress, productTransferPoint, shortestHeadingDelta, wheelRollDelta } from "@/game/animation/CustomerCartMotion";
import { PRODUCT_RETAIL_DEPARTMENT, retailDisplayPosition } from "@/game/stations/retail-layout";
import { BasketProduct } from "./HarvestBasket";

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
const CART_SCALE = 0.92;
const CART_HANDLE_Z = -0.43;
const CART_HANDLE_BASE_WIDTH = 0.78;
const CART_MAX_FOLLOW_LAG = 0.075;
const CART_BAY_POSITION = scaleStorePoint([3.05, 6.55]);
const PICKUP_HEIGHT: Record<ProductId, number> = { tomatoes: 0.86, apples: 0.86, corn: 0.92, eggs: 0.92, milk: 1.02, cheese: 1.02, juice: 1.02, bread: 0.9, flour: 0.9, wheat: 0.9, coffee: 0.9 };

export function Customer({ customer, checkoutTransaction, simulationTimeMs }: { customer: CustomerRuntimeState; checkoutTransaction?: CheckoutTransaction; simulationTimeMs: number }) {
  const id = customer.identity;
  const root = useRef<THREE.Group>(null);
  const characterRoot = useRef<THREE.Group>(null);
  const carrySocket = useRef<THREE.Group>(null);
  const initialPosition = scaleStorePoint([customer.x, customer.z]);
  const cart = useRef<THREE.Group>(null);
  const cartHandle = useRef<THREE.Group>(null);
  const cartBasketSocket = useRef<THREE.Group>(null);
  const cartCasterFrontLeft = useRef<THREE.Group>(null);
  const cartCasterFrontRight = useRef<THREE.Group>(null);
  const cartCasterRearLeft = useRef<THREE.Group>(null);
  const cartCasterRearRight = useRef<THREE.Group>(null);
  const cartWheelFrontLeft = useRef<THREE.Group>(null);
  const cartWheelFrontRight = useRef<THREE.Group>(null);
  const cartWheelRearLeft = useRef<THREE.Group>(null);
  const cartWheelRearRight = useRef<THREE.Group>(null);
  const pickupVisual = useRef<THREE.Group>(null);
  const bag = useRef<THREE.Group>(null);
  const activeAnimation = useRef<CustomerAnimation>("Idle");
  const visualGaitScale = useRef(1);
  const visualFrame = useRef(0);
  const visualState = useRef(customer.state);
  const visualStateStartedAt = useRef(nowMs());
  const cartWasVisible = useRef(false);
  const cartWheelRotation = useRef(0);
  const cartSteering = useRef(0);
  const pickupFrames = useRef(0);
  const checkoutLoadingUnitKey = useRef<string | null>(null);
  const previousHeading = useRef(0);
  const stableHeadQuaternion = useRef(new THREE.Quaternion());
  const desiredHeadQuaternion = useRef(new THREE.Quaternion());
  const leftHandWorldPosition = useRef(new THREE.Vector3());
  const rightHandWorldPosition = useRef(new THREE.Vector3());
  const leftHandLocalPosition = useRef(new THREE.Vector3());
  const rightHandLocalPosition = useRef(new THREE.Vector3());
  const carryLocalPosition = useRef(new THREE.Vector3());
  const gripLocalPosition = useRef(new THREE.Vector3());
  const desiredCartPosition = useRef(new THREE.Vector3());
  const cartBayLocalPosition = useRef(new THREE.Vector3());
  const cartWorldPosition = useRef(new THREE.Vector3());
  const previousCartWorldPosition = useRef(new THREE.Vector3());
  const cartTravelDirection = useRef(new THREE.Vector3());
  const cartForwardDirection = useRef(new THREE.Vector3());
  const cartHandleWorldPosition = useRef(new THREE.Vector3());
  const cartHandleWorldQuaternion = useRef(new THREE.Quaternion());
  const cartHandleAxis = useRef(new THREE.Vector3());
  const cartHandleEndA = useRef(new THREE.Vector3());
  const cartHandleEndB = useRef(new THREE.Vector3());
  const cartBasketLocalPosition = useRef(new THREE.Vector3());
  const pickupSourceLocalPosition = useRef(new THREE.Vector3());
  const pickupPoint = useRef(new THREE.Vector3());
  const customerWorldPosition = useRef(new THREE.Vector3());
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
  const model = useMemo(() => prepareCharacterModel(gltf.scene, { crowd: true }), [gltf.scene]);
  const { actions } = useAnimations(gltf.animations, model);
  const morphMeshes = useMemo(() => collectMorphMeshes(model), [model]);
  const leftHand = useMemo(() => model.getObjectByName("Hand_L"), [model]);
  const rightHand = useMemo(() => model.getObjectByName("Hand_R"), [model]);
  const head = useMemo(() => model.getObjectByName("Head"), [model]);
  const currentProduct = customer.shoppingList[customer.currentLine]?.productId ?? null;
  const productDisplay = currentProduct ? retailDisplayPosition(PRODUCT_RETAIL_DEPARTMENT[currentProduct]) : null;
  const cartInventory = checkoutCartInventory(customer.basket, checkoutTransaction);
  const checkoutLoading = checkoutLoadingPresentation(customer.state, checkoutTransaction, simulationTimeMs);

  useEffect(() => {
    actions.Idle?.reset().play();
    return () => {
      Object.values(actions).forEach((action) => action?.stop());
      const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
      const visuals = qaWindow.__MARKET_QA__?.customerVisuals as Record<string, unknown> | undefined;
      if (visuals) delete visuals[customer.id];
    };
  }, [actions, customer.id]);

  useEffect(() => () => disposeCharacterMaterials(model), [model]);

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
    const frameNow = nowMs();
    const previousVisualState = visualState.current;
    if (visualState.current !== customer.state) {
      visualState.current = customer.state;
      visualStateStartedAt.current = frameNow;
    }
    const stateElapsedMs = frameNow - visualStateStartedAt.current;
    const projected = projectCustomerMotion(motionSnapshot.current, frameNow);
    const [x, z] = scaleStorePoint([projected.x, projected.z]);
    const animation = customerAnimation(customer, clock.elapsedTime, Boolean(checkoutLoading));

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
    const headingBefore = group.rotation.y;
    if (Math.hypot(projected.headingX, projected.headingZ) > 0.5) {
      const angle = Math.atan2(projected.headingX, projected.headingZ);
      group.rotation.y = turnTowards(group.rotation.y, angle, frameDelta(delta) * 3.35);
    } else if (productDisplay && ["WAIT_FOR_ACCESS", "PICK_PRODUCT", "WAIT_RESTOCK"].includes(customer.state)) {
      const [displayX, displayZ] = scaleStorePoint([productDisplay[0], productDisplay[2]]);
      const angle = Math.atan2(displayX - group.position.x, displayZ - group.position.z);
      group.rotation.y = turnTowards(group.rotation.y, angle, frameDelta(delta) * 3.8);
    }
    const headingStep = shortestHeadingDelta(headingBefore, group.rotation.y);
    const locomotion = animation === "Enter" || animation === "Exit" || animation === "Walk" || animation === "CarryBasket";
    if (characterRoot.current) {
      const turnLean = locomotion ? THREE.MathUtils.clamp(-headingStep / Math.max(0.001, frameDelta(delta)) * 0.014, -0.045, 0.045) : 0;
      characterRoot.current.rotation.z = THREE.MathUtils.lerp(characterRoot.current.rotation.z, turnLean, dampFactor(7, delta));
      characterRoot.current.rotation.x = THREE.MathUtils.lerp(characterRoot.current.rotation.x, locomotion ? -0.012 : 0, dampFactor(7, delta));
    }
    if (characterRoot.current && carrySocket.current && leftHand) {
      characterRoot.current.updateWorldMatrix(true, false);
      leftHand.updateWorldMatrix(true, false);
      leftHand.getWorldPosition(leftHandWorldPosition.current);
      characterRoot.current.worldToLocal(carryLocalPosition.current.copy(leftHandWorldPosition.current));
      carrySocket.current.position.copy(carryLocalPosition.current);
    }
    const cartVisible = customer.hasCart || customer.state === "GET_CART";
    const cartGroup = cart.current;
    let handleGripDistance: number | null = null;
    let leftGripDistance: number | null = null;
    let rightGripDistance: number | null = null;
    if (cartGroup) cartGroup.visible = cartVisible;
    if (cartGroup && leftHand && rightHand && cartHandle.current) {
      group.updateWorldMatrix(true, false);
      leftHand.updateWorldMatrix(true, false);
      rightHand.updateWorldMatrix(true, false);
      leftHand.getWorldPosition(leftHandWorldPosition.current);
      rightHand.getWorldPosition(rightHandWorldPosition.current);
      group.worldToLocal(leftHandLocalPosition.current.copy(leftHandWorldPosition.current));
      group.worldToLocal(rightHandLocalPosition.current.copy(rightHandWorldPosition.current));

      const singleLeftGrip = checkoutLoading !== null || ["PICK_PRODUCT", "UNLOAD", "LEAVE_RETURNS", "RETURN_CART"].includes(customer.state);
      const settlingAfterCartPickup = customer.state === "NAVIGATE_TO_PRODUCT"
        && customer.currentLine === 0
        && customer.shoppingList.every((line) => line.picked === 0)
        && stateElapsedMs < 240;
      const singleRightGrip = ["GET_CART", "BUILD_SHOPPING_LIST", "TAKE_BAG"].includes(customer.state) || settlingAfterCartPickup;
      let handleWidth = CART_HANDLE_BASE_WIDTH;
      if (singleLeftGrip) {
        gripLocalPosition.current.copy(leftHandLocalPosition.current);
        desiredCartPosition.current.x = gripLocalPosition.current.x + CART_HANDLE_BASE_WIDTH * CART_SCALE * 0.5;
      } else if (singleRightGrip) {
        gripLocalPosition.current.copy(rightHandLocalPosition.current);
        desiredCartPosition.current.x = gripLocalPosition.current.x - CART_HANDLE_BASE_WIDTH * CART_SCALE * 0.5;
      } else {
        gripLocalPosition.current.copy(leftHandLocalPosition.current).add(rightHandLocalPosition.current).multiplyScalar(0.5);
        handleWidth = THREE.MathUtils.clamp(Math.abs(rightHandLocalPosition.current.x - leftHandLocalPosition.current.x) / CART_SCALE, 0.64, 0.9);
        desiredCartPosition.current.x = gripLocalPosition.current.x;
      }
      desiredCartPosition.current.y = 0;
      desiredCartPosition.current.z = gripLocalPosition.current.z - CART_HANDLE_Z * CART_SCALE;
      // The handle is the physical constraint driven by the animated hands.
      // Do not ease its socket independently: doing so creates a visible gap
      // whenever the arm pose crosses an animation boundary.
      cartHandle.current.position.y = THREE.MathUtils.clamp(gripLocalPosition.current.y / CART_SCALE, 0.7, 1.18);
      cartHandle.current.scale.x = handleWidth / CART_HANDLE_BASE_WIDTH;

      if (customer.state === "GET_CART" || customer.state === "RETURN_CART") {
        const pointInParent = pickupPoint.current.set(CART_BAY_POSITION[0], 0, CART_BAY_POSITION[1]);
        group.parent?.localToWorld(pointInParent);
        group.worldToLocal(cartBayLocalPosition.current.copy(pointInParent));
        const duration = customer.state === "GET_CART" ? 450 : 420;
        const progress = easedMotionProgress(stateElapsedMs, duration);
        if (customer.state === "GET_CART") desiredCartPosition.current.lerpVectors(cartBayLocalPosition.current, desiredCartPosition.current, progress);
        else desiredCartPosition.current.lerp(cartBayLocalPosition.current, progress);
      }

      const completedCartPickup = previousVisualState === "GET_CART" && customer.state !== "GET_CART";
      if ((!cartWasVisible.current && cartVisible) || completedCartPickup) cartGroup.position.copy(desiredCartPosition.current);
      else if (cartVisible) {
        cartGroup.position.lerp(desiredCartPosition.current, dampFactor(30, delta));
        const remainingLag = cartGroup.position.distanceTo(desiredCartPosition.current);
        if (remainingLag > CART_MAX_FOLLOW_LAG) {
          cartGroup.position.lerp(desiredCartPosition.current, 1 - CART_MAX_FOLLOW_LAG / remainingLag);
        }
      }
      cartGroup.rotation.y = THREE.MathUtils.lerp(cartGroup.rotation.y, 0, dampFactor(14, delta));
      cartGroup.updateWorldMatrix(true, false);

      const headingDelta = shortestHeadingDelta(previousHeading.current, group.rotation.y);
      const targetSteering = cartSteeringAngle(headingDelta, frameDelta(delta));
      cartSteering.current = THREE.MathUtils.lerp(cartSteering.current, targetSteering, dampFactor(10, delta));
      for (const caster of [cartCasterFrontLeft.current, cartCasterFrontRight.current]) if (caster) caster.rotation.y = cartSteering.current;
      for (const caster of [cartCasterRearLeft.current, cartCasterRearRight.current]) if (caster) caster.rotation.y = cartSteering.current * 0.32;

      cartGroup.getWorldPosition(cartWorldPosition.current);
      if (cartWasVisible.current && cartVisible) {
        cartTravelDirection.current.copy(cartWorldPosition.current).sub(previousCartWorldPosition.current);
        const travelled = cartTravelDirection.current.length() / WORLD_SCALE;
        cartGroup.getWorldDirection(cartForwardDirection.current);
        const signedDistance = cartTravelDirection.current.dot(cartForwardDirection.current) >= 0 ? travelled : -travelled;
        const roll = wheelRollDelta(signedDistance / CART_SCALE, CUSTOMER_CART_WHEEL_RADIUS);
        cartWheelRotation.current -= roll;
        for (const wheel of [cartWheelFrontLeft.current, cartWheelFrontRight.current, cartWheelRearLeft.current, cartWheelRearRight.current]) if (wheel) wheel.rotation.x -= roll;
      }
      previousCartWorldPosition.current.copy(cartWorldPosition.current);

      cartHandle.current.updateWorldMatrix(true, false);
      cartHandle.current.getWorldPosition(cartHandleWorldPosition.current);
      cartHandle.current.getWorldQuaternion(cartHandleWorldQuaternion.current);
      cartHandleAxis.current.set(1, 0, 0).applyQuaternion(cartHandleWorldQuaternion.current).normalize();
      const halfHandleWorld = CART_HANDLE_BASE_WIDTH * 0.5 * CART_SCALE * WORLD_SCALE * cartHandle.current.scale.x;
      cartHandleEndA.current.copy(cartHandleWorldPosition.current).addScaledVector(cartHandleAxis.current, halfHandleWorld);
      cartHandleEndB.current.copy(cartHandleWorldPosition.current).addScaledVector(cartHandleAxis.current, -halfHandleWorld);
      leftGripDistance = Math.min(leftHandWorldPosition.current.distanceTo(cartHandleEndA.current), leftHandWorldPosition.current.distanceTo(cartHandleEndB.current));
      rightGripDistance = Math.min(rightHandWorldPosition.current.distanceTo(cartHandleEndA.current), rightHandWorldPosition.current.distanceTo(cartHandleEndB.current));
      handleGripDistance = singleLeftGrip ? leftGripDistance : singleRightGrip ? rightGripDistance : Math.max(leftGripDistance, rightGripDistance);
    }
    cartWasVisible.current = cartVisible;
    previousHeading.current = group.rotation.y;

    let pickupProgress: number | null = null;
    if (pickupVisual.current) {
      const pickupActive = customer.state === "PICK_PRODUCT" && Boolean(currentProduct) && cartVisible && Boolean(productDisplay) && Boolean(rightHand) && Boolean(cartBasketSocket.current);
      pickupVisual.current.visible = pickupActive;
      if (pickupActive && currentProduct && productDisplay && rightHand && cartBasketSocket.current) {
        pickupFrames.current += 1;
        pickupProgress = motionProgress(stateElapsedMs, CUSTOMER_PICKUP_DURATION_MS);
        const [displayX, displayZ] = scaleStorePoint([productDisplay[0], productDisplay[2]]);
        const towardCustomerX = group.position.x - displayX;
        const towardCustomerZ = group.position.z - displayZ;
        const sourceDistance = Math.max(0.001, Math.hypot(towardCustomerX, towardCustomerZ));
        const edge = 0.92 * STORE_ELEMENT_SCALE;
        const lateral = productPickupLateralOffset(currentProduct) * STORE_ELEMENT_SCALE;
        const sourceInParent = pickupSourceLocalPosition.current.set(
          displayX + towardCustomerX / sourceDistance * edge - towardCustomerZ / sourceDistance * lateral,
          PICKUP_HEIGHT[currentProduct] * STORE_ELEMENT_SCALE,
          displayZ + towardCustomerZ / sourceDistance * edge + towardCustomerX / sourceDistance * lateral,
        );
        group.parent?.localToWorld(sourceInParent);
        group.worldToLocal(sourceInParent);
        group.worldToLocal(rightHandLocalPosition.current.copy(rightHandWorldPosition.current));
        cartBasketSocket.current.getWorldPosition(cartBasketLocalPosition.current);
        group.worldToLocal(cartBasketLocalPosition.current);
        const point = productTransferPoint(sourceInParent.toArray(), rightHandLocalPosition.current.toArray(), cartBasketLocalPosition.current.toArray(), pickupProgress);
        pickupVisual.current.position.set(...point);
        pickupVisual.current.rotation.y += frameDelta(delta) * 4.8;
      }
    }

    if (bag.current) {
      const receivingBag = customer.state === "TAKE_BAG";
      bag.current.visible = receivingBag || (customer.hasBag && !customer.hasCart);
      const bagScale = receivingBag ? 0.72 + easedMotionProgress(stateElapsedMs, 520) * 0.28 : 1;
      bag.current.scale.setScalar(bagScale);
    }
    const targetGaitScale = locomotion ? THREE.MathUtils.clamp(visualSpeed / 1.3, 0.82, 1.5) : 1;
    visualGaitScale.current = THREE.MathUtils.lerp(visualGaitScale.current, targetGaitScale, dampFactor(9, delta));
    const loadingUnitKey = checkoutLoading ? `${checkoutLoading.transactionId}:${checkoutLoading.unitIndex}` : null;
    const loadingUnitChanged = loadingUnitKey !== null && checkoutLoadingUnitKey.current !== loadingUnitKey;
    if (animation !== activeAnimation.current) {
      actions[activeAnimation.current]?.fadeOut(0.2);
      actions[animation]?.reset().setEffectiveTimeScale(visualGaitScale.current).fadeIn(0.2).play();
      activeAnimation.current = animation;
    } else if (loadingUnitChanged) {
      // A loaded counter increment marks the end of the prior handoff and the
      // exact beginning of the next per-unit gesture.
      actions.CheckoutItem?.reset().play();
    }
    checkoutLoadingUnitKey.current = loadingUnitKey;
    const animationAction = actions[animation];
    const animationTimeScale = checkoutLoading && animation === "CheckoutItem" && animationAction
      ? animationAction.getClip().duration / (CUSTOMER_CHECKOUT_ITEM_CYCLE_MS / 1_000)
      : visualGaitScale.current;
    animationAction?.setEffectiveTimeScale(animationTimeScale);

    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    if (qaWindow.__MARKET_QA__) {
      const visuals = (qaWindow.__MARKET_QA__.customerVisuals ??= {}) as Record<string, unknown>;
      let cartDistance: number | null = null;
      if (cart.current?.visible) {
        cart.current.getWorldPosition(carryObjectWorldPosition.current);
        group.getWorldPosition(customerWorldPosition.current);
        cartDistance = customerWorldPosition.current.distanceTo(carryObjectWorldPosition.current);
      }
      const basketUnits = Object.values(cartInventory).reduce((total, quantity) => total + (quantity ?? 0), 0);
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
        cartGripDistance: handleGripDistance,
        cartLeftGripDistance: leftGripDistance,
        cartRightGripDistance: rightGripDistance,
        cartSteering: cartSteering.current,
        cartWheelRotation: cartWheelRotation.current,
        cartProductUnits: basketUnits,
        checkoutLoadedUnits: checkoutTransaction?.pendingItems.reduce((total, line) => total + line.loaded, 0) ?? 0,
        checkoutLoadingUnit: checkoutLoading?.unitIndex ?? null,
        checkoutLoadingProgress: checkoutLoading?.cycleProgress ?? null,
        pickupVisible: pickupVisual.current?.visible ?? false,
        pickupProduct: customer.state === "PICK_PRODUCT" ? currentProduct : null,
        pickupProgress,
        pickupFrames: pickupFrames.current,
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
    <CustomerCart
      ref={cart}
      inventory={cartInventory}
      bagged={customer.hasBag}
      compact={compactModel}
      handleRef={cartHandle}
      basketSocketRef={cartBasketSocket}
      casterRefs={[cartCasterFrontLeft, cartCasterFrontRight, cartCasterRearLeft, cartCasterRearRight]}
      wheelRefs={[cartWheelFrontLeft, cartWheelFrontRight, cartWheelRearLeft, cartWheelRearRight]}
    />
    {currentProduct && <group ref={pickupVisual} visible={false}>
      <BasketProduct productId={currentProduct} scale={1.35} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.11, 0]}><ringGeometry args={[0.1, 0.16, 18]} /><meshBasicMaterial color="#ffe394" transparent opacity={0.72} depthWrite={false} /></mesh>
    </group>}
  </group>;
}

function collectMorphMeshes(model: THREE.Group) {
  const meshes: THREE.Mesh[] = [];
  model.traverse((object) => {
    if (object instanceof THREE.Mesh && object.morphTargetDictionary && object.morphTargetInfluences) meshes.push(object);
  });
  return meshes;
}

function customerAnimation(customer: CustomerRuntimeState, elapsed = 0, checkoutLoading = false): CustomerAnimation {
  switch (customer.state) {
    case "ENTER_STORE": return "Enter";
    case "GET_CART":
    case "BUILD_SHOPPING_LIST": return "CarryBasket";
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
    case "WAIT_CHECKOUT": return checkoutLoading ? "CheckoutItem" : customer.identity % 3 === 0 ? "Confused" : customer.identity % 2 ? "Wait" : "Queue";
    case "PAY": return "Pay";
    case "NAVIGATE_TO_BAG": return "CarryBasket";
    case "TAKE_BAG": return "ReceiveBag";
    case "NAVIGATE_TO_RETURNS": return "CarryBasket";
    case "LEAVE_RETURNS": return "CheckoutItem";
    case "NAVIGATE_TO_CART_RETURN": return "CarryBasket";
    case "RETURN_CART": return "CheckoutItem";
    case "EXIT_STORE": return "Exit";
    case "WAIT_RESTOCK": return "Confused";
    default: return "Idle";
  }
}

function setMorph(dictionary: Record<string, number>, influences: number[], name: string, value: number) {
  const index = dictionary[name];
  if (index !== undefined) influences[index] = value;
}

function productPickupLateralOffset(productId: ProductId) {
  if (productId === "tomatoes" || productId === "milk") return -0.42;
  if (productId === "corn" || productId === "cheese") return 0.42;
  return 0;
}

function GroundingShadow() {
  return <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.58, 0.34, 1]} renderOrder={-1}>
    <circleGeometry args={[1, 24]} />
    <meshBasicMaterial color="#15251f" transparent opacity={0.2} depthWrite={false} />
  </mesh>;
}

const CART_BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const CART_CYLINDER_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 12);
const CART_WHEEL_GEOMETRY = new THREE.CylinderGeometry(CUSTOMER_CART_WHEEL_RADIUS, CUSTOMER_CART_WHEEL_RADIUS, 0.055, 14);
const CART_METAL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#8c9995", metalness: 0.64, roughness: 0.28 });
const CART_DARK_METAL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#53615d", metalness: 0.54, roughness: 0.38 });
const CART_GRIP_MATERIAL = new THREE.MeshStandardMaterial({ color: "#3f6e54", roughness: 0.48, metalness: 0.06 });
const CART_WHEEL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#202725", roughness: 0.78 });
const CART_PANEL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#426f58", roughness: 0.58 });

type CustomerCartProps = {
  inventory: CustomerRuntimeState["basket"];
  bagged: boolean;
  compact: boolean;
  handleRef: RefObject<THREE.Group | null>;
  basketSocketRef: RefObject<THREE.Group | null>;
  casterRefs: readonly RefObject<THREE.Group | null>[];
  wheelRefs: readonly RefObject<THREE.Group | null>[];
};

const CustomerCart = forwardRef<THREE.Group, CustomerCartProps>(function CustomerCart({ inventory, bagged, compact, handleRef, basketSocketRef, casterRefs, wheelRefs }, ref) {
  const units = (Object.entries(inventory) as [ProductId, number][])
    .flatMap(([productId, quantity]) => Array.from({ length: Math.min(quantity, compact ? 2 : 3) }, () => productId))
    .slice(0, compact ? 5 : 8);
  const rails: { key: string; position: [number, number, number]; scale: [number, number, number] }[] = [
    { key: "floor", position: [0, 0.31, 0.05], scale: [0.72, 0.035, 0.58] },
    ...[-0.36, 0.36].flatMap((x) => [
      { key: `upright-${x}-rear`, position: [x, 0.52, -0.25] as [number, number, number], scale: [0.035, 0.46, 0.035] as [number, number, number] },
      { key: `upright-${x}-front`, position: [x, 0.52, 0.34] as [number, number, number], scale: [0.035, 0.46, 0.035] as [number, number, number] },
      ...[0.34, 0.49, 0.65, 0.74].map((y) => ({ key: `side-${x}-${y}`, position: [x, y, 0.045] as [number, number, number], scale: [0.035, 0.027, 0.62] as [number, number, number] })),
    ]),
    ...[0.34, 0.5, 0.66, 0.75].flatMap((y) => [-0.25, 0.34].map((z) => ({ key: `cross-${y}-${z}`, position: [0, y, z] as [number, number, number], scale: [0.75, 0.027, 0.035] as [number, number, number] }))),
  ];
  return <group ref={ref} position={[0, 0, 0.46]} scale={CART_SCALE} visible={false} dispose={null}>
    {rails.map((rail) => <mesh key={rail.key} geometry={CART_BOX_GEOMETRY} material={CART_METAL_MATERIAL} position={rail.position} scale={rail.scale} />)}
    <mesh geometry={CART_BOX_GEOMETRY} material={CART_PANEL_MATERIAL} position={[0, 0.63, -0.27]} scale={[0.68, 0.22, 0.045]} />
    <mesh geometry={CART_BOX_GEOMETRY} material={CART_DARK_METAL_MATERIAL} position={[0, 0.22, -0.12]} rotation={[-0.12, 0, 0]} scale={[0.68, 0.055, 0.49]} />
    {[-0.31, 0.31].map((x) => <mesh key={`support-${x}`} geometry={CART_BOX_GEOMETRY} material={CART_DARK_METAL_MATERIAL} position={[x, 0.53, -0.3]} rotation={[-0.41, 0, 0]} scale={[0.04, 0.64, 0.04]} />)}
    <group ref={handleRef} position={[0, 0.82, CART_HANDLE_Z]}>
      <mesh geometry={CART_CYLINDER_GEOMETRY} material={CART_GRIP_MATERIAL} rotation={[0, 0, Math.PI / 2]} scale={[0.04, CART_HANDLE_BASE_WIDTH, 0.04]} />
      {[-0.5, 0.5].map((side) => <mesh key={side} geometry={CART_CYLINDER_GEOMETRY} material={CART_DARK_METAL_MATERIAL} position={[side * CART_HANDLE_BASE_WIDTH, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.052, 0.07, 0.052]} />)}
    </group>
    <group ref={basketSocketRef} position={[0, 0.43, 0.05]}>
      {units.map((productId, index) => <BasketProduct
        key={`${productId}-${index}`}
        productId={productId}
        position={[(index % 3 - 1) * 0.18, Math.floor(index / 3) * 0.14, (index % 2 ? -1 : 1) * 0.12]}
        rotation={[0, index * 1.41, index % 2 ? -0.08 : 0.08]}
        scale={1.05}
      />)}
      {bagged && <CustomerBagInCart />}
    </group>
    <CartCaster casterRef={casterRefs[0]} wheelRef={wheelRefs[0]} position={[-0.3, 0.09, 0.27]} />
    <CartCaster casterRef={casterRefs[1]} wheelRef={wheelRefs[1]} position={[0.3, 0.09, 0.27]} />
    <CartCaster casterRef={casterRefs[2]} wheelRef={wheelRefs[2]} position={[-0.3, 0.09, -0.22]} />
    <CartCaster casterRef={casterRefs[3]} wheelRef={wheelRefs[3]} position={[0.3, 0.09, -0.22]} />
  </group>;
});

function CartCaster({ casterRef, wheelRef, position }: { casterRef: RefObject<THREE.Group | null>; wheelRef: RefObject<THREE.Group | null>; position: [number, number, number] }) {
  return <group ref={casterRef} position={position}>
    <mesh geometry={CART_BOX_GEOMETRY} material={CART_DARK_METAL_MATERIAL} position={[0, 0.065, 0]} scale={[0.035, 0.13, 0.035]} />
    <group ref={wheelRef}>
      <mesh geometry={CART_WHEEL_GEOMETRY} material={CART_WHEEL_MATERIAL} rotation={[0, 0, Math.PI / 2]} />
      <mesh rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[0.045, 0.008, 5, 12]} /><meshStandardMaterial color="#707b77" metalness={0.68} roughness={0.28} /></mesh>
    </group>
  </group>;
}

function CustomerBagInCart() {
  return <group position={[0, 0.2, 0]} scale={0.86}>
    <mesh geometry={CART_BOX_GEOMETRY} position={[0, 0, 0]} scale={[0.42, 0.5, 0.28]}><meshStandardMaterial color="#bd8550" roughness={0.92} /></mesh>
    <mesh position={[0, 0.29, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.13, 0.018, 6, 12, Math.PI]} /><meshStandardMaterial color="#8c5e38" /></mesh>
  </group>;
}

const CustomerBag = forwardRef<THREE.Group>(function CustomerBag(_, ref) {
  return <group ref={ref} position={[0, -0.28, 0.08]} rotation={[0.03, 0, 0.03]} visible={false}>
    <mesh><boxGeometry args={[0.42, 0.5, 0.26]} /><meshStandardMaterial color="#bd8550" roughness={0.92} /></mesh>
    <mesh position={[0, 0.29, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.13, 0.018, 6, 12, Math.PI]} /><meshStandardMaterial color="#8c5e38" /></mesh>
  </group>;
});

function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
