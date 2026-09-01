import type { CheckoutTransaction, Inventory, ProductId } from "../types";

export type MotionPoint3 = readonly [number, number, number];

export const CUSTOMER_PICKUP_DURATION_MS = 520;
export const CUSTOMER_CART_WHEEL_RADIUS = 0.075;
export const CUSTOMER_CHECKOUT_ITEM_CYCLE_MS = 900;

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
