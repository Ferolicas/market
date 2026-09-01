import type { CheckoutTransaction, Inventory, ProductId } from "../types";
import * as THREE from "three";

export type MotionPoint3 = readonly [number, number, number];

export const CUSTOMER_PICKUP_DURATION_MS = 520;
export const CUSTOMER_CART_WHEEL_RADIUS = 0.075;
export const CUSTOMER_CHECKOUT_ITEM_CYCLE_MS = 900;

export type CartGripChain = Readonly<{
  upperArm: THREE.Object3D;
  forearm: THREE.Object3D;
  hand: THREE.Object3D;
}>;

/**
 * Allocation-free analytic two-segment IK for the small correction between
 * the authored carry pose and a rigid cart handle. Animation still owns the
 * pose every frame; this solver only closes the final wrist-to-handle gap.
 */
export class CustomerCartGripSolver {
  private readonly jointPosition = new THREE.Vector3();
  private readonly elbowPosition = new THREE.Vector3();
  private readonly handPosition = new THREE.Vector3();
  private readonly currentDirection = new THREE.Vector3();
  private readonly targetDirection = new THREE.Vector3();
  private readonly bendDirection = new THREE.Vector3();
  private readonly desiredElbow = new THREE.Vector3();
  private readonly rotationAxis = new THREE.Vector3();
  private readonly jointWorldQuaternion = new THREE.Quaternion();
  private readonly parentWorldQuaternion = new THREE.Quaternion();
  private readonly worldDelta = new THREE.Quaternion();
  private readonly desiredWorldQuaternion = new THREE.Quaternion();

  solve(chain: CartGripChain, target: THREE.Vector3) {
    chain.upperArm.updateWorldMatrix(true, true);
    chain.upperArm.getWorldPosition(this.jointPosition);
    chain.forearm.getWorldPosition(this.elbowPosition);
    chain.hand.getWorldPosition(this.handPosition);
    const upperLength = this.jointPosition.distanceTo(this.elbowPosition);
    const forearmLength = this.elbowPosition.distanceTo(this.handPosition);
    this.targetDirection.copy(target).sub(this.jointPosition);
    const targetDistance = this.targetDirection.length();
    if (upperLength > 1e-4 && forearmLength > 1e-4 && targetDistance > 1e-4) {
      this.targetDirection.multiplyScalar(1 / targetDistance);
      const reach = THREE.MathUtils.clamp(targetDistance, Math.abs(upperLength - forearmLength) + 1e-4, upperLength + forearmLength - 1e-4);
      const elbowAlongTarget = (upperLength * upperLength - forearmLength * forearmLength + reach * reach) / (2 * reach);
      const elbowOffAxis = Math.sqrt(Math.max(0, upperLength * upperLength - elbowAlongTarget * elbowAlongTarget));
      this.bendDirection.copy(this.elbowPosition).sub(this.jointPosition);
      this.bendDirection.addScaledVector(this.targetDirection, -this.bendDirection.dot(this.targetDirection));
      if (this.bendDirection.lengthSq() < 1e-8) {
        this.bendDirection.set(0, 0, 1).transformDirection(chain.upperArm.matrixWorld);
        this.bendDirection.addScaledVector(this.targetDirection, -this.bendDirection.dot(this.targetDirection));
      }
      if (this.bendDirection.lengthSq() >= 1e-8) {
        this.bendDirection.normalize();
        this.desiredElbow.copy(this.jointPosition)
          .addScaledVector(this.targetDirection, elbowAlongTarget)
          .addScaledVector(this.bendDirection, elbowOffAxis);
        this.rotateJoint(chain.upperArm, chain.forearm, this.desiredElbow, 0.51);
      }
    }
    // The forearm supplies the final reach while the bounded shoulder change
    // preserves the authored silhouette and avoids a robotic straight arm.
    this.rotateJoint(chain.forearm, chain.hand, target, 1.1);

    chain.hand.updateWorldMatrix(true, false);
    chain.hand.getWorldPosition(this.handPosition);
    return this.handPosition.distanceTo(target);
  }

  private rotateJoint(joint: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, maxRadians: number) {
    joint.updateWorldMatrix(true, false);
    hand.updateWorldMatrix(true, false);
    joint.getWorldPosition(this.jointPosition);
    hand.getWorldPosition(this.handPosition);
    this.currentDirection.copy(this.handPosition).sub(this.jointPosition);
    this.targetDirection.copy(target).sub(this.jointPosition);
    const currentLengthSq = this.currentDirection.lengthSq();
    const targetLengthSq = this.targetDirection.lengthSq();
    if (currentLengthSq < 1e-8 || targetLengthSq < 1e-8) return;

    this.currentDirection.multiplyScalar(1 / Math.sqrt(currentLengthSq));
    this.targetDirection.multiplyScalar(1 / Math.sqrt(targetLengthSq));
    const cosine = THREE.MathUtils.clamp(this.currentDirection.dot(this.targetDirection), -1, 1);
    const angle = Math.min(Math.acos(cosine), maxRadians);
    if (angle < 1e-5) return;
    this.rotationAxis.crossVectors(this.currentDirection, this.targetDirection);
    if (this.rotationAxis.lengthSq() < 1e-8) return;
    this.rotationAxis.normalize();
    this.worldDelta.setFromAxisAngle(this.rotationAxis, angle);
    joint.getWorldQuaternion(this.jointWorldQuaternion);
    this.desiredWorldQuaternion.multiplyQuaternions(this.worldDelta, this.jointWorldQuaternion);
    if (joint.parent) {
      joint.parent.getWorldQuaternion(this.parentWorldQuaternion).invert();
      joint.quaternion.multiplyQuaternions(this.parentWorldQuaternion, this.desiredWorldQuaternion);
    } else {
      joint.quaternion.copy(this.desiredWorldQuaternion);
    }
    joint.updateWorldMatrix(false, true);
  }
}

/** Assign distinct handle ends with the minimum total hand travel. */
export function assignCartGripTargets(
  leftHand: THREE.Vector3,
  rightHand: THREE.Vector3,
  endA: THREE.Vector3,
  endB: THREE.Vector3,
  leftTarget: THREE.Vector3,
  rightTarget: THREE.Vector3,
) {
  const direct = leftHand.distanceToSquared(endA) + rightHand.distanceToSquared(endB);
  const crossed = leftHand.distanceToSquared(endB) + rightHand.distanceToSquared(endA);
  if (direct <= crossed) {
    leftTarget.copy(endA);
    rightTarget.copy(endB);
    return false;
  }
  leftTarget.copy(endB);
  rightTarget.copy(endA);
  return true;
}

export function motionProgress(elapsedMs: number, durationMs: number) {
  if (!Number.isFinite(elapsedMs) || durationMs <= 0) return elapsedMs > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, elapsedMs / durationMs));
}

export function easedMotionProgress(elapsedMs: number, durationMs: number) {
  const progress = motionProgress(elapsedMs, durationMs);
  return progress * progress * (3 - 2 * progress);
}

/**
 * A two-stage shelf -> hand -> cart route. Keeping the hand as a real waypoint
 * makes the purchase readable instead of teleporting stock between counters.
 */
export function productTransferPoint(source: MotionPoint3, hand: MotionPoint3, cart: MotionPoint3, progress: number): [number, number, number] {
  const value = Math.min(1, Math.max(0, progress));
  const firstLeg = value <= 0.42;
  const legProgress = firstLeg ? value / 0.42 : (value - 0.42) / 0.58;
  const eased = legProgress * legProgress * (3 - 2 * legProgress);
  const start = firstLeg ? source : hand;
  const end = firstLeg ? hand : cart;
  const lift = Math.sin(Math.PI * eased) * (firstLeg ? 0.13 : 0.2);
  return [
    start[0] + (end[0] - start[0]) * eased,
    start[1] + (end[1] - start[1]) * eased + lift,
    start[2] + (end[2] - start[2]) * eased,
  ];
}

export function wheelRollDelta(distance: number, radius = CUSTOMER_CART_WHEEL_RADIUS) {
  if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0) return 0;
  return distance / radius;
}

export function shortestHeadingDelta(previous: number, current: number) {
  const fullTurn = Math.PI * 2;
  return ((current - previous + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

export function cartSteeringAngle(headingDelta: number, deltaSeconds: number) {
  if (!Number.isFinite(headingDelta) || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
  return Math.min(0.48, Math.max(-0.48, headingDelta / deltaSeconds * 0.16));
}

/** The save keeps the customer's complete purchase until bag handoff. For the
 * cart presentation, units cease to belong to the cart the instant the
 * authoritative checkout transaction marks them as loaded. */
export function checkoutCartInventory(basket: Partial<Inventory>, transaction?: Pick<CheckoutTransaction, "pendingItems" | "state"> | null): Partial<Inventory> {
  const remaining: Partial<Inventory> = {};
  for (const [productId, quantity] of Object.entries(basket) as [ProductId, number][]) {
    if (quantity > 0) remaining[productId] = quantity;
  }
  if (!transaction || transaction.state === "ABANDONED") return remaining;
  for (const line of transaction.pendingItems) {
    const quantity = Math.max(0, (remaining[line.productId] ?? 0) - Math.min(line.quantity, Math.max(0, line.loaded)));
    if (quantity > 0) remaining[line.productId] = quantity;
    else delete remaining[line.productId];
  }
  return remaining;
}

/**
 * Mirrors one authoritative checkout-loading interval as presentation data.
 * The transaction remains the source of truth: this helper never advances an
 * item, it only gives the character a readable gesture for the current unit.
 */
export function checkoutLoadingPresentation(
  customerState: string,
  transaction: Pick<CheckoutTransaction, "id" | "state" | "pendingItems" | "lastLoadedAt"> | null | undefined,
  simulationTimeMs: number,
  cycleMs = CUSTOMER_CHECKOUT_ITEM_CYCLE_MS,
) {
  if (customerState !== "WAIT_CHECKOUT" || transaction?.state !== "CUSTOMER_LOADING") return null;
  const totals = transaction.pendingItems.reduce((result, line) => ({
    total: result.total + Math.max(0, line.quantity),
    loaded: result.loaded + Math.min(Math.max(0, line.quantity), Math.max(0, line.loaded)),
  }), { total: 0, loaded: 0 });
  if (totals.loaded >= totals.total) return null;
  return {
    transactionId: transaction.id,
    unitIndex: totals.loaded,
    remainingUnits: totals.total - totals.loaded,
    cycleProgress: motionProgress(simulationTimeMs - transaction.lastLoadedAt, cycleMs),
  };
}
