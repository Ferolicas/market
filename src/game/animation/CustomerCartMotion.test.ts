import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CustomerCartGripSolver, assignCartGripTargets, cartSteeringAngle, checkoutCartInventory, checkoutLoadingPresentation, easedMotionProgress, productTransferPoint, shortestHeadingDelta, wheelRollDelta } from "./CustomerCartMotion";

describe("customer cart visual motion", () => {
  it("passes a picked product through the customer's hand before the cart", () => {
    const source = [0, 1, 2] as const;
    const hand = [0.5, 1.2, 1] as const;
    const cart = [0, 0.6, 0.5] as const;

    expect(productTransferPoint(source, hand, cart, 0)).toEqual([...source]);
    expect(productTransferPoint(source, hand, cart, 0.42)).toEqual([...hand]);
    expect(productTransferPoint(source, hand, cart, 1)).toEqual([...cart]);
    expect(productTransferPoint(source, hand, cart, 0.2)[1]).toBeGreaterThan(1);
  });

  it("eases taking and returning a cart without overshooting", () => {
    expect(easedMotionProgress(-10, 450)).toBe(0);
    expect(easedMotionProgress(225, 450)).toBeCloseTo(0.5);
    expect(easedMotionProgress(900, 450)).toBe(1);
  });

  it("rolls wheels by travelled circumference and clamps caster steering", () => {
    expect(wheelRollDelta(0.15, 0.075)).toBeCloseTo(2);
    expect(shortestHeadingDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(cartSteeringAngle(0.4, 1 / 60)).toBe(0.48);
    expect(cartSteeringAngle(-0.4, 1 / 60)).toBe(-0.48);
  });

  it("removes loaded checkout units from the cart without mutating the saved basket", () => {
    const basket = { tomatoes: 3, apples: 2 };
    const remaining = checkoutCartInventory(basket, {
      state: "CUSTOMER_LOADING",
      pendingItems: [
        { productId: "tomatoes", quantity: 3, loaded: 1, scanned: 0, bagged: 0 },
        { productId: "apples", quantity: 2, loaded: 2, scanned: 1, bagged: 0 },
      ],
    });

    expect(remaining).toEqual({ tomatoes: 2 });
    expect(basket).toEqual({ tomatoes: 3, apples: 2 });
  });

  it("keeps the complete cart when a checkout is abandoned", () => {
    expect(checkoutCartInventory({ bread: 2 }, {
      state: "ABANDONED",
      pendingItems: [{ productId: "bread", quantity: 2, loaded: 2, scanned: 1, bagged: 0 }],
    })).toEqual({ bread: 2 });
  });

  it("drives one checkout gesture cycle for every authoritatively loading unit", () => {
    const transaction = {
      id: "checkout-1",
      state: "CUSTOMER_LOADING" as const,
      lastLoadedAt: 1_000,
      pendingItems: [
        { productId: "tomatoes" as const, quantity: 2, loaded: 1, scanned: 0, bagged: 0 },
        { productId: "bread" as const, quantity: 1, loaded: 0, scanned: 0, bagged: 0 },
      ],
    };

    expect(checkoutLoadingPresentation("WAIT_CHECKOUT", transaction, 1_450)).toEqual({
      transactionId: "checkout-1",
      unitIndex: 1,
      remainingUnits: 2,
      cycleProgress: 0.5,
    });
    expect(checkoutLoadingPresentation("QUEUE_WAIT", transaction, 1_450)).toBeNull();
    expect(checkoutLoadingPresentation("WAIT_CHECKOUT", { ...transaction, state: "SCANNING" }, 1_450)).toBeNull();
  });

  it("assigns a different rigid handle end to each hand with minimum total travel", () => {
    const leftTarget = new THREE.Vector3();
    const rightTarget = new THREE.Vector3();
    const crossed = assignCartGripTargets(
      new THREE.Vector3(-0.4, 1, 0),
      new THREE.Vector3(0.4, 1, 0),
      new THREE.Vector3(0.5, 1, 0),
      new THREE.Vector3(-0.5, 1, 0),
      leftTarget,
      rightTarget,
    );

    expect(crossed).toBe(true);
    expect(leftTarget.toArray()).toEqual([-0.5, 1, 0]);
    expect(rightTarget.toArray()).toEqual([0.5, 1, 0]);
    expect(leftTarget.equals(rightTarget)).toBe(false);
  });

  it("closes the wrist-to-handle gap with a bounded two-joint correction", () => {
    const root = new THREE.Object3D();
    const upperArm = new THREE.Object3D();
    const forearm = new THREE.Object3D();
    const hand = new THREE.Object3D();
    forearm.position.x = 1;
    hand.position.x = 1;
    root.add(upperArm);
    upperArm.add(forearm);
    forearm.add(hand);
    root.updateWorldMatrix(true, true);
    const target = new THREE.Vector3(1.6, 0.8, 0);
    const before = hand.getWorldPosition(new THREE.Vector3()).distanceTo(target);

    const after = new CustomerCartGripSolver().solve({ upperArm, forearm, hand }, target);

    expect(after).toBeLessThan(before * 0.08);
    expect(upperArm.quaternion.angleTo(new THREE.Quaternion())).toBeLessThanOrEqual(0.51 + 1e-6);
    // 1.1 rad remains well inside anatomical elbow flexion while allowing the
    // wrist to meet a rigid bar instead of stretching the cart itself.
    expect(forearm.quaternion.angleTo(new THREE.Quaternion())).toBeLessThanOrEqual(1.1 + 1e-6);
  });

  it("keeps the grip correction finite when a target is outside arm reach", () => {
    const upperArm = new THREE.Object3D();
    const forearm = new THREE.Object3D();
    const hand = new THREE.Object3D();
    forearm.position.x = 0.4;
    hand.position.x = 0.4;
    upperArm.add(forearm);
    forearm.add(hand);

    const after = new CustomerCartGripSolver().solve({ upperArm, forearm, hand }, new THREE.Vector3(50, 20, -10));

    expect(Number.isFinite(after)).toBe(true);
    expect(upperArm.quaternion.angleTo(new THREE.Quaternion())).toBeLessThanOrEqual(0.51 + 1e-6);
    expect(forearm.quaternion.angleTo(new THREE.Quaternion())).toBeLessThanOrEqual(1.1 + 1e-6);
  });
});
