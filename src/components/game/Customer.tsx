"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { forwardRef, useEffect, useEffectEvent, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { dampFactor, frameDelta, turnTowards, type VisitorAnimation } from "@/game/locomotion";
import type { CheckoutTransaction, CustomerRuntimeState, ProductId } from "@/game/types";
import { scaleStorePoint, STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE, WORLD_SCALE } from "@/game/world-scale";
import { FacialController, type FaceExpression } from "@/game/animation/FacialController";
import { CHARACTER_FACE_UPDATE_INTERVAL, characterIsInView, characterModelPathForTier, createCharacterVisibilityScratch, disposeCharacterMaterials, prepareCharacterModel, useCharacterModelTier } from "@/game/animation/CharacterPresentation";
import { captureCustomerMotion, projectCustomerMotion } from "@/game/animation/CustomerVisualMotion";
import { marketQaQueryEnabled } from "@/game/debug/QaAccess";
import { CUSTOMER_CART_WHEEL_RADIUS, CUSTOMER_CHECKOUT_ITEM_CYCLE_MS, CUSTOMER_PICKUP_DURATION_MS, CustomerCartGripSolver, assignCartGripTargets, cartSteeringAngle, checkoutCartInventory, checkoutLoadingPresentation, easedMotionProgress, motionProgress, productTransferPoint, shortestHeadingDelta, wheelRollDelta, type CartGripChain } from "@/game/animation/CustomerCartMotion";
import { PRODUCT_RETAIL_DEPARTMENT, retailDisplayPosition } from "@/game/stations/retail-layout";
import { CART_BAY_POINT } from "@/game/stations/store-service-layout";
import { checkoutCustomerFacingYaw } from "@/game/stations/checkout-layout";
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

const LOD1_PATHS = Object.fromEntries(Object.entries(MODEL_PATHS).map(([id, path]) => [id, characterModelPathForTier(path, 1)])) as Record<CustomerId, string>;
const LOD2_PATHS = Object.fromEntries(Object.entries(MODEL_PATHS).map(([id, path]) => [id, characterModelPathForTier(path, 2)])) as Record<CustomerId, string>;
const CUSTOMER_SCALE: Record<CustomerId, number> = { 1: 1.29, 2: 1.28, 3: 1.32, 4: 1.32, 5: 1.32, 6: 1.27 };
const CART_SCALE = 0.92;
const CART_HANDLE_Z = -0.43;
const CART_HANDLE_Y = 0.82;
const CART_HANDLE_BASE_WIDTH = 0.78;
const CART_MAX_FOLLOW_LAG = 0.075;
const CART_BAY_POSITION = scaleStorePoint([...CART_BAY_POINT]);
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
  const cartCasters = useRef<THREE.InstancedMesh>(null);
  const cartWheels = useRef<THREE.InstancedMesh>(null);
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
  const leftGripTarget = useRef(new THREE.Vector3());
  const rightGripTarget = useRef(new THREE.Vector3());
  const cartBasketLocalPosition = useRef(new THREE.Vector3());
  const pickupSourceLocalPosition = useRef(new THREE.Vector3());
  const pickupPoint = useRef(new THREE.Vector3());
  const customerWorldPosition = useRef(new THREE.Vector3());
  const carryObjectWorldPosition = useRef(new THREE.Vector3());
  const headInitialized = useRef(false);
  const facial = useRef(new FacialController(customer.identity * 97));
  const lastFacialUpdate = useRef(Number.NEGATIVE_INFINITY);
  const visibilityScratch = useMemo(() => createCharacterVisibilityScratch(), []);
  const motionSnapshot = useRef(captureCustomerMotion(customer, nowMs()));
  const refreshMotionSnapshot = useEffectEvent(() => {
    motionSnapshot.current = captureCustomerMotion(customer, nowMs());
  });
  // Orthographic distance does not change screen size, so select one source by
  // live device capability rather than loading all LODs into GPU memory.
  const modelTier = useCharacterModelTier();
  const modelPath = modelTier === 2 ? LOD2_PATHS[id] : modelTier === 1 ? LOD1_PATHS[id] : MODEL_PATHS[id];
  const gltf = useGLTF(modelPath);
  const model = useMemo(() => prepareCharacterModel(gltf.scene, { crowd: true, reducedDetail: modelTier > 0 }), [gltf.scene, modelTier]);
  const { actions, mixer } = useAnimations(gltf.animations, model);
  const mixerRef = useRef(mixer);
  const morphMeshes = useMemo(() => collectMorphMeshes(model), [model]);
  const leftHand = useMemo(() => model.getObjectByName("Hand_L"), [model]);
  const rightHand = useMemo(() => model.getObjectByName("Hand_R"), [model]);
  const leftGripChain = useMemo(() => collectCartGripChain(model, "L"), [model]);
  const rightGripChain = useMemo(() => collectCartGripChain(model, "R"), [model]);
  const cartGripSolver = useMemo(() => new CustomerCartGripSolver(), []);
  const head = useMemo(() => model.getObjectByName("Head"), [model]);
  const currentProduct = customer.shoppingList[customer.currentLine]?.productId ?? null;
  const productDisplay = currentProduct ? retailDisplayPosition(PRODUCT_RETAIL_DEPARTMENT[currentProduct]) : null;
  const cartInventory = checkoutCartInventory(customer.basket, checkoutTransaction);
  const checkoutLoading = checkoutLoadingPresentation(customer.state, checkoutTransaction, simulationTimeMs);

  useEffect(() => {
    mixerRef.current = mixer;
  }, [mixer]);

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

  useFrame(({ camera, clock }, delta) => {
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

    group.visible = customer.state !== "DESPAWN";
    const previousX = group.position.x; const previousZ = group.position.z;
    // The projected point is already the continuous interpolation of the
    // authoritative NavMesh path. Smoothing it again makes the body trail the
    // route and produces a visible stop/start pulse at snapshot boundaries.
    group.position.x = x;
    group.position.z = z;
    const visualSpeed = Math.hypot(group.position.x - previousX, group.position.z - previousZ) / Math.max(0.001, frameDelta(delta)) / STORE_LAYOUT_SCALE;
    const headingBefore = group.rotation.y;
    const desiredCheckoutYaw = checkoutCustomerFacingYaw(customer, [projected.x, projected.z]);
    if (desiredCheckoutYaw !== null) {
      group.rotation.y = turnTowards(group.rotation.y, desiredCheckoutYaw, frameDelta(delta) * 3.8);
    } else if (Math.hypot(projected.headingX, projected.headingZ) > 0.5) {
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
    const cartVisible = customer.hasCart || customer.state === "GET_CART";
    const cartGroup = cart.current;
    if (cartGroup) cartGroup.visible = cartVisible;
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    const qaVisuals = qaWindow.__MARKET_QA__ && marketQaQueryEnabled(window.location.search)
      ? (qaWindow.__MARKET_QA__.customerVisuals ??= {}) as Record<string, unknown>
      : null;
    if (qaVisuals) {
      const previous = qaVisuals[customer.id];
      qaVisuals[customer.id] = {
        ...(previous && typeof previous === "object" ? previous : {}),
        visualFrame: visualFrame.current,
        state: customer.state,
        animation,
        x: group.position.x,
        z: group.position.z,
        rotationY: group.rotation.y,
        checkoutFacingYaw: desiredCheckoutYaw,
        checkoutFacingError: desiredCheckoutYaw === null ? null : Math.abs(shortestHeadingDelta(group.rotation.y, desiredCheckoutYaw)),
        speed: motionSnapshot.current.speed,
        snapshotCapturedAtMs: motionSnapshot.current.capturedAtMs,
      };
    }
    const inView = group.visible && characterIsInView(camera, group, visibilityScratch);
    mixerRef.current.timeScale = inView ? 1 : 0;
    if (!inView) {
      cartWasVisible.current = false;
      if (pickupVisual.current) pickupVisual.current.visible = false;
      return;
    }

    if (clock.elapsedTime - lastFacialUpdate.current >= CHARACTER_FACE_UPDATE_INTERVAL || clock.elapsedTime < lastFacialUpdate.current) {
      lastFacialUpdate.current = clock.elapsedTime;
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
    if (characterRoot.current && carrySocket.current && leftHand) {
      characterRoot.current.updateWorldMatrix(true, false);
      leftHand.updateWorldMatrix(true, false);
      leftHand.getWorldPosition(leftHandWorldPosition.current);
      characterRoot.current.worldToLocal(carryLocalPosition.current.copy(leftHandWorldPosition.current));
      carrySocket.current.position.copy(carryLocalPosition.current);
    }
    let handleGripDistance: number | null = null;
    let leftGripDistance: number | null = null;
    let rightGripDistance: number | null = null;
    if (cartVisible && cartGroup && leftHand && rightHand && cartHandle.current) {
      group.updateWorldMatrix(true, false);
      leftHand.updateWorldMatrix(true, false);
      rightHand.updateWorldMatrix(true, false);
      leftHand.getWorldPosition(leftHandWorldPosition.current);
      rightHand.getWorldPosition(rightHandWorldPosition.current);
      group.worldToLocal(leftHandLocalPosition.current.copy(leftHandWorldPosition.current));
      group.worldToLocal(rightHandLocalPosition.current.copy(rightHandWorldPosition.current));

      const singleLeftGrip = checkoutLoading !== null || ["PICK_PRODUCT", "UNLOAD", "PAY", "LEAVE_RETURNS", "RETURN_CART"].includes(customer.state);
      const settlingAfterCartPickup = customer.state === "NAVIGATE_TO_PRODUCT"
        && customer.currentLine === 0
        && customer.shoppingList.every((line) => line.picked === 0)
        && stateElapsedMs < 240;
      const singleRightGrip = ["GET_CART", "BUILD_SHOPPING_LIST", "TAKE_BAG"].includes(customer.state) || settlingAfterCartPickup;
      if (singleLeftGrip) {
        gripLocalPosition.current.copy(leftHandLocalPosition.current);
        desiredCartPosition.current.x = gripLocalPosition.current.x + CART_HANDLE_BASE_WIDTH * CART_SCALE * 0.5;
      } else if (singleRightGrip) {
        gripLocalPosition.current.copy(rightHandLocalPosition.current);
        desiredCartPosition.current.x = gripLocalPosition.current.x - CART_HANDLE_BASE_WIDTH * CART_SCALE * 0.5;
      } else {
        gripLocalPosition.current.copy(leftHandLocalPosition.current).add(rightHandLocalPosition.current).multiplyScalar(0.5);
        desiredCartPosition.current.x = gripLocalPosition.current.x;
      }
      desiredCartPosition.current.y = 0;
      desiredCartPosition.current.z = gripLocalPosition.current.z - CART_HANDLE_Z * CART_SCALE;
      // The handle is a rigid part of the cart. The arm chains close the final
      // animated gap below; changing its height or width would make the metal
      // frame visibly breathe at clip boundaries.
      cartHandle.current.position.y = CART_HANDLE_Y;
      cartHandle.current.scale.x = 1;

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

      cartGroup.getWorldPosition(cartWorldPosition.current);
      if (cartWasVisible.current && cartVisible) {
        cartTravelDirection.current.copy(cartWorldPosition.current).sub(previousCartWorldPosition.current);
        const travelled = cartTravelDirection.current.length() / WORLD_SCALE;
        cartGroup.getWorldDirection(cartForwardDirection.current);
        const signedDistance = cartTravelDirection.current.dot(cartForwardDirection.current) >= 0 ? travelled : -travelled;
        const roll = wheelRollDelta(signedDistance / CART_SCALE, CUSTOMER_CART_WHEEL_RADIUS);
        cartWheelRotation.current -= roll;
      }
      previousCartWorldPosition.current.copy(cartWorldPosition.current);
      updateCartInstances(cartCasters.current, cartWheels.current, cartSteering.current, cartWheelRotation.current);

      cartHandle.current.updateWorldMatrix(true, false);
      cartHandle.current.getWorldPosition(cartHandleWorldPosition.current);
      cartHandle.current.getWorldQuaternion(cartHandleWorldQuaternion.current);
      cartHandleAxis.current.set(1, 0, 0).applyQuaternion(cartHandleWorldQuaternion.current).normalize();
      const halfHandleWorld = CART_HANDLE_BASE_WIDTH * 0.5 * CART_SCALE * WORLD_SCALE;
      cartHandleEndA.current.copy(cartHandleWorldPosition.current).addScaledVector(cartHandleAxis.current, halfHandleWorld);
      cartHandleEndB.current.copy(cartHandleWorldPosition.current).addScaledVector(cartHandleAxis.current, -halfHandleWorld);
      assignCartGripTargets(
        leftHandWorldPosition.current,
        rightHandWorldPosition.current,
        cartHandleEndA.current,
        cartHandleEndB.current,
        leftGripTarget.current,
        rightGripTarget.current,
      );
      if (cartVisible) {
        if (!singleRightGrip && leftGripChain) cartGripSolver.solve(leftGripChain, leftGripTarget.current);
        if (!singleLeftGrip && rightGripChain) cartGripSolver.solve(rightGripChain, rightGripTarget.current);
        leftHand.updateWorldMatrix(true, false);
        rightHand.updateWorldMatrix(true, false);
        leftHand.getWorldPosition(leftHandWorldPosition.current);
        rightHand.getWorldPosition(rightHandWorldPosition.current);
        leftGripDistance = leftHandWorldPosition.current.distanceTo(leftGripTarget.current);
        rightGripDistance = rightHandWorldPosition.current.distanceTo(rightGripTarget.current);
        handleGripDistance = singleLeftGrip ? leftGripDistance : singleRightGrip ? rightGripDistance : Math.max(leftGripDistance, rightGripDistance);
      }
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

    if (qaVisuals) {
      let cartDistance: number | null = null;
      if (cart.current?.visible) {
        cart.current.getWorldPosition(carryObjectWorldPosition.current);
        group.getWorldPosition(customerWorldPosition.current);
        cartDistance = customerWorldPosition.current.distanceTo(carryObjectWorldPosition.current);
      }
      const basketUnits = Object.values(cartInventory).reduce((total, quantity) => total + (quantity ?? 0), 0);
      qaVisuals[customer.id] = {
        visualFrame: visualFrame.current,
        state: customer.state,
        animation,
        x: group.position.x,
        z: group.position.z,
        rotationY: group.rotation.y,
        checkoutFacingYaw: desiredCheckoutYaw,
        checkoutFacingError: desiredCheckoutYaw === null ? null : Math.abs(shortestHeadingDelta(group.rotation.y, desiredCheckoutYaw)),
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
        characterModelTier: modelTier,
        cartBaseDrawCalls: customerCartBaseDrawCalls(cart.current),
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
      compact={modelTier > 0}
      handleRef={cartHandle}
      basketSocketRef={cartBasketSocket}
      casterRef={cartCasters}
      wheelRef={cartWheels}
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

function collectCartGripChain(model: THREE.Group, side: "L" | "R"): CartGripChain | null {
  const upperArm = model.getObjectByName(`Rig_Arm_${side}`);
  const forearm = model.getObjectByName(`Forearm_${side}`);
  const hand = model.getObjectByName(`Hand_${side}`);
  return upperArm && forearm && hand ? { upperArm, forearm, hand } : null;
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
const CART_HUB_GEOMETRY = new THREE.CylinderGeometry(0.032, 0.032, 0.062, 12);
const CART_METAL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#a1aca8", metalness: 0.62, roughness: 0.3 });
const CART_DARK_METAL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#56635f", metalness: 0.48, roughness: 0.4 });
const CART_GRIP_MATERIAL = new THREE.MeshStandardMaterial({ color: "#315f4d", roughness: 0.55, metalness: 0.04 });
const CART_WHEEL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#252b29", roughness: 0.82 });
const CART_PANEL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#426f5d", roughness: 0.62 });

type CartTubeTransform = Readonly<{
  key: string;
  position: readonly [number, number, number];
  quaternion: THREE.Quaternion;
  scale: readonly [number, number, number];
  dark?: boolean;
}>;

function cartTube(key: string, from: readonly [number, number, number], to: readonly [number, number, number], radius: number, dark = false): CartTubeTransform {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const length = direction.length();
  return {
    key,
    position: start.add(end).multiplyScalar(0.5).toArray(),
    quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()),
    scale: [radius, length, radius],
    dark,
  };
}

const CART_BASKET_TOP = {
  leftRear: [-0.37, 0.75, -0.25] as const,
  rightRear: [0.37, 0.75, -0.25] as const,
  leftFront: [-0.4, 0.75, 0.34] as const,
  rightFront: [0.4, 0.75, 0.34] as const,
};
const CART_BASKET_BOTTOM = {
  leftRear: [-0.28, 0.34, -0.19] as const,
  rightRear: [0.28, 0.34, -0.19] as const,
  leftFront: [-0.31, 0.34, 0.27] as const,
  rightFront: [0.31, 0.34, 0.27] as const,
};
const CART_TUBES: readonly CartTubeTransform[] = [
  cartTube("top-rear", CART_BASKET_TOP.leftRear, CART_BASKET_TOP.rightRear, 0.014),
  cartTube("top-front", CART_BASKET_TOP.leftFront, CART_BASKET_TOP.rightFront, 0.014),
  cartTube("top-left", CART_BASKET_TOP.leftRear, CART_BASKET_TOP.leftFront, 0.014),
  cartTube("top-right", CART_BASKET_TOP.rightRear, CART_BASKET_TOP.rightFront, 0.014),
  cartTube("bottom-rear", CART_BASKET_BOTTOM.leftRear, CART_BASKET_BOTTOM.rightRear, 0.012),
  cartTube("bottom-front", CART_BASKET_BOTTOM.leftFront, CART_BASKET_BOTTOM.rightFront, 0.012),
  cartTube("bottom-left", CART_BASKET_BOTTOM.leftRear, CART_BASKET_BOTTOM.leftFront, 0.012),
  cartTube("bottom-right", CART_BASKET_BOTTOM.rightRear, CART_BASKET_BOTTOM.rightFront, 0.012),
  cartTube("corner-left-rear", CART_BASKET_BOTTOM.leftRear, CART_BASKET_TOP.leftRear, 0.013),
  cartTube("corner-right-rear", CART_BASKET_BOTTOM.rightRear, CART_BASKET_TOP.rightRear, 0.013),
  cartTube("corner-left-front", CART_BASKET_BOTTOM.leftFront, CART_BASKET_TOP.leftFront, 0.013),
  cartTube("corner-right-front", CART_BASKET_BOTTOM.rightFront, CART_BASKET_TOP.rightFront, 0.013),
  ...[-0.23, -0.075, 0.075, 0.23].map((x) => cartTube(`basket-long-${x}`, [x, 0.34, -0.19], [x * 1.34, 0.75, 0.34], 0.008)),
  ...[-0.08, 0.09, 0.25].flatMap((z) => [-1, 1].map((side) => cartTube(`basket-side-${side}-${z}`, [side * 0.29, 0.39, z], [side * 0.39, 0.7, z + 0.035], 0.008))),
  cartTube("handle-stay-left", CART_BASKET_TOP.leftRear, [-0.39, CART_HANDLE_Y, CART_HANDLE_Z], 0.018, true),
  cartTube("handle-stay-right", CART_BASKET_TOP.rightRear, [0.39, CART_HANDLE_Y, CART_HANDLE_Z], 0.018, true),
  cartTube("chassis-left", [-0.3, 0.14, -0.24], [-0.31, 0.27, 0.28], 0.019, true),
  cartTube("chassis-right", [0.3, 0.14, -0.24], [0.31, 0.27, 0.28], 0.019, true),
  cartTube("rear-axle", [-0.34, 0.14, -0.22], [0.34, 0.14, -0.22], 0.016, true),
  cartTube("front-axle", [-0.34, 0.14, 0.27], [0.34, 0.14, 0.27], 0.016, true),
];

const CART_FRAME_METAL_GEOMETRY = mergedGeometry(CART_TUBES
  .filter((tube) => !tube.dark)
  .map((tube) => transformedGeometry(CART_CYLINDER_GEOMETRY, tube.position, tube.quaternion, tube.scale)));
const CART_FRAME_DARK_GEOMETRY = mergedGeometry([
  ...CART_TUBES
    .filter((tube) => tube.dark)
    .map((tube) => transformedGeometry(CART_CYLINDER_GEOMETRY, tube.position, tube.quaternion, tube.scale)),
  transformedGeometry(CART_BOX_GEOMETRY, [0, 0.27, 0.04], undefined, [0.64, 0.032, 0.5]),
  transformedGeometry(CART_BOX_GEOMETRY, [0, 0.455, -0.205], undefined, [0.04, 0.15, 0.04]),
]);
const CART_PANEL_GEOMETRY = mergedGeometry([
  transformedGeometry(CART_BOX_GEOMETRY, [0, 0.65, -0.265], new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, 0, 0)), [0.54, 0.21, 0.035]),
  transformedGeometry(CART_BOX_GEOMETRY, [0, 0.545, -0.13], new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08, 0, 0)), [0.5, 0.035, 0.24]),
]);
const CART_HANDLE_GRIP_GEOMETRY = transformedGeometry(
  CART_CYLINDER_GEOMETRY,
  [0, 0, 0],
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
  [0.04, CART_HANDLE_BASE_WIDTH, 0.04],
);
const CART_HANDLE_END_GEOMETRY = mergedGeometry([-0.5, 0.5].map((side) => transformedGeometry(
  CART_CYLINDER_GEOMETRY,
  [side * CART_HANDLE_BASE_WIDTH, 0, 0],
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
  [0.052, 0.07, 0.052],
)));
const CART_CASTER_GEOMETRY = mergedGeometry([
  transformedGeometry(CART_CYLINDER_GEOMETRY, [0, 0.07, 0], undefined, [0.022, 0.14, 0.022]),
  ...[-0.042, 0.042].map((x) => transformedGeometry(CART_BOX_GEOMETRY, [x, 0.025, 0], undefined, [0.012, 0.07, 0.026])),
]);
const CART_WHEEL_METAL_GEOMETRY = mergedGeometry([
  transformedGeometry(CART_HUB_GEOMETRY, [0, 0, 0], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2))),
  transformedGeometry(CART_BOX_GEOMETRY, [0, 0.038, 0], undefined, [0.063, 0.01, 0.014]),
]);
const CART_WHEEL_ASSEMBLY_GEOMETRY = mergedGeometry([
  transformedGeometry(CART_WHEEL_GEOMETRY, [0, 0, 0], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2))),
  CART_WHEEL_METAL_GEOMETRY,
], true);
const CART_CASTER_POSITIONS = [
  [-0.3, 0.09, 0.27],
  [0.3, 0.09, 0.27],
  [-0.3, 0.09, -0.22],
  [0.3, 0.09, -0.22],
] as const;
const CART_INSTANCE_MATRIX = new THREE.Matrix4();
const CART_INSTANCE_POSITION = new THREE.Vector3();
const CART_INSTANCE_YAW = new THREE.Quaternion();
const CART_INSTANCE_ROLL = new THREE.Quaternion();
const CART_INSTANCE_SCALE = new THREE.Vector3(1, 1, 1);
const CART_Y_AXIS = new THREE.Vector3(0, 1, 0);
const CART_X_AXIS = new THREE.Vector3(1, 0, 0);

/** Static frame (3), handle (2), caster brackets (1) and two-material wheels
 * (2). Products and the optional paper bag are inventory, not cart chassis. */
export const CUSTOMER_CART_BASE_DRAW_CALLS = 8;

type CustomerCartProps = {
  inventory: CustomerRuntimeState["basket"];
  bagged: boolean;
  compact: boolean;
  handleRef: RefObject<THREE.Group | null>;
  basketSocketRef: RefObject<THREE.Group | null>;
  casterRef: RefObject<THREE.InstancedMesh | null>;
  wheelRef: RefObject<THREE.InstancedMesh | null>;
};

const CustomerCart = forwardRef<THREE.Group, CustomerCartProps>(function CustomerCart({ inventory, bagged, compact, handleRef, basketSocketRef, casterRef, wheelRef }, ref) {
  const units = (Object.entries(inventory) as [ProductId, number][])
    .flatMap(([productId, quantity]) => Array.from({ length: Math.min(quantity, compact ? 2 : 3) }, () => productId))
    .slice(0, compact ? 5 : 8);
  return <group ref={ref} position={[0, 0, 0.46]} scale={CART_SCALE} visible={false} dispose={null}>
    <mesh name="CustomerCartFrameMetal" geometry={CART_FRAME_METAL_GEOMETRY} material={CART_METAL_MATERIAL} />
    <mesh name="CustomerCartFrameDark" geometry={CART_FRAME_DARK_GEOMETRY} material={CART_DARK_METAL_MATERIAL} />
    <mesh name="CustomerCartPanels" geometry={CART_PANEL_GEOMETRY} material={CART_PANEL_MATERIAL} />
    <group ref={handleRef} position={[0, CART_HANDLE_Y, CART_HANDLE_Z]}>
      <mesh name="CustomerCartHandleGrip" geometry={CART_HANDLE_GRIP_GEOMETRY} material={CART_GRIP_MATERIAL} />
      <mesh name="CustomerCartHandleEnds" geometry={CART_HANDLE_END_GEOMETRY} material={CART_DARK_METAL_MATERIAL} />
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
    <instancedMesh name="CustomerCartCasters" ref={casterRef} args={[CART_CASTER_GEOMETRY, CART_DARK_METAL_MATERIAL, 4]} />
    <instancedMesh name="CustomerCartWheels" ref={wheelRef} args={[CART_WHEEL_ASSEMBLY_GEOMETRY, [CART_WHEEL_MATERIAL, CART_METAL_MATERIAL], 4]} />
  </group>;
});

function updateCartInstances(casters: THREE.InstancedMesh | null, wheels: THREE.InstancedMesh | null, steering: number, wheelRotation: number) {
  if (!casters || !wheels) return;
  for (let index = 0; index < CART_CASTER_POSITIONS.length; index += 1) {
    const yaw = index < 2 ? steering : steering * 0.32;
    const [x, y, z] = CART_CASTER_POSITIONS[index];
    CART_INSTANCE_POSITION.set(x, y, z);
    CART_INSTANCE_YAW.setFromAxisAngle(CART_Y_AXIS, yaw);
    CART_INSTANCE_MATRIX.compose(CART_INSTANCE_POSITION, CART_INSTANCE_YAW, CART_INSTANCE_SCALE);
    casters.setMatrixAt(index, CART_INSTANCE_MATRIX);

    CART_INSTANCE_ROLL.setFromAxisAngle(CART_X_AXIS, wheelRotation);
    CART_INSTANCE_YAW.multiply(CART_INSTANCE_ROLL);
    CART_INSTANCE_MATRIX.compose(CART_INSTANCE_POSITION, CART_INSTANCE_YAW, CART_INSTANCE_SCALE);
    wheels.setMatrixAt(index, CART_INSTANCE_MATRIX);
  }
  casters.instanceMatrix.needsUpdate = true;
  wheels.instanceMatrix.needsUpdate = true;
}

function transformedGeometry(
  source: THREE.BufferGeometry,
  position: readonly [number, number, number],
  quaternion = new THREE.Quaternion(),
  scale: readonly [number, number, number] = [1, 1, 1],
) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    quaternion,
    new THREE.Vector3(...scale),
  );
  return source.clone().applyMatrix4(matrix);
}

function mergedGeometry(geometries: THREE.BufferGeometry[], useGroups = false) {
  const geometry = mergeGeometries(geometries, useGroups);
  if (!geometry) throw new Error("Customer cart geometry attributes are incompatible");
  geometry.computeBoundingSphere();
  return geometry;
}

function customerCartBaseDrawCalls(cartRoot: THREE.Group | null) {
  if (!cartRoot) return 0;
  let draws = 0;
  cartRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.name.startsWith("CustomerCart")) return;
    draws += Array.isArray(object.material) ? Math.max(1, object.geometry.groups.length) : 1;
  });
  return draws;
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
