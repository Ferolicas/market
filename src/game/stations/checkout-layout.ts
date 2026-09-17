import type { CheckoutTransaction, CustomerRuntimeState } from "../types";

export type CheckoutLane = 0 | 1 | 2;
/** Every till the store can open, in the order cashiers fill them. */
export const CHECKOUT_LANE_IDS = [0, 1, 2] as const satisfies readonly CheckoutLane[];
export type StorePoint = readonly [x: number, z: number];
export type StorePosition = readonly [x: number, y: number, z: number];

export interface CheckoutLaneLayout {
  counter: StorePosition;
  cashierWork: StorePosition;
  customerFront: StorePoint;
  queueStart: StorePoint;
  bagPickup: StorePoint;
}

/**
 * One source of truth for checkout geometry and navigation.
 * Positive Z is the entrance side: cashiers stand there facing into the store,
 * while customers approach from the sales floor on the negative-Z side.
 * The tills form one column at x 7.55 every 3 units towards the rear. The
 * third lane's queue starts further east than the others because the drinks
 * display's service point (5.45, −3.1) sits where its queue would otherwise
 * begin; slots then run south, between the display and the preserves gondola.
 */
export const CHECKOUT_LANES: Record<CheckoutLane, CheckoutLaneLayout> = {
  0: {
    counter: [7.55, 0, 3.95],
    cashierWork: [8.05, 0.018, 5.12],
    customerFront: [7, 2.85],
    queueStart: [5.35, 2.85],
    bagPickup: [8.9, 2.85],
  },
  1: {
    counter: [7.55, 0, 0.95],
    cashierWork: [8.05, 0.018, 2.12],
    customerFront: [7, -0.15],
    queueStart: [5.35, -0.15],
    bagPickup: [8.9, -0.15],
  },
  2: {
    counter: [7.55, 0, -2.05],
    cashierWork: [8.05, 0.018, -0.88],
    customerFront: [7, -3.15],
    queueStart: [6.1, -3.95],
    bagPickup: [8.9, -3.15],
  },
};

export function isCheckoutLane(value: unknown): value is CheckoutLane {
  return value === 0 || value === 1 || value === 2;
}

/** Saved lanes predate the third till or may be missing: fall back to the first. */
export function checkoutLaneOf(value: number | null | undefined): CheckoutLane {
  return isCheckoutLane(value) ? value : 0;
}

/** The area that opens each till; the first one exists from the start. */
export function checkoutAreaForLane(lane: CheckoutLane) {
  return `checkout-${lane + 1}`;
}

/** Tills open in order, so the count stops at the first closed one. */
export function openCheckoutLaneCount(areas: readonly string[]) {
  let count = 1;
  while (count < CHECKOUT_LANE_IDS.length && areas.includes(checkoutAreaForLane(count as CheckoutLane))) count += 1;
  return count;
}

export const CHECKOUT_CAMERA_TARGET: StorePosition = [7.35, 1.25, 3.55];
export const CHECKOUT_CAMERA_POSITION: StorePosition = [8.8, 3.2, 6.8];
export const CHECKOUT_CAMERA_FRAME = { width: 10, height: 10 } as const;

/** Cart parks on the customer's right, on the sales-floor side of the belt. */
export function checkoutParkedCart(customer: Pick<CustomerRuntimeState, "state" | "queueLane" | "queueSlot" | "x" | "z">): StorePoint | null {
  const front = CHECKOUT_LANES[checkoutLaneOf(customer.queueLane)].customerFront;
  const serving = ["UNLOAD", "WAIT_CHECKOUT", "PAY"].includes(customer.state);
  const approaching = customer.queueSlot === 0 && ["NAVIGATE_TO_QUEUE", "MOVE_QUEUE"].includes(customer.state)
    && Math.hypot(customer.x - front[0], customer.z - front[1]) < 1.2;
  return serving || approaching ? [front[0] + 1, front[1] - 0.45] : null;
}

const CHECKOUT_QUEUE_SPACING = 0.78;
const CHECKOUT_CUSTOMER_FACING_STATES = new Set<CustomerRuntimeState["state"]>([
  "QUEUE_WAIT",
  "UNLOAD",
  "WAIT_CHECKOUT",
  "PAY",
]);

export function checkoutQueuePosition(slot: number, lane: CheckoutLane = 0): [number, number] {
  const layout = CHECKOUT_LANES[lane];
  if (slot <= 0) return [...layout.customerFront];
  return [layout.queueStart[0], layout.queueStart[1] - (slot - 1) * CHECKOUT_QUEUE_SPACING];
}

/**
 * Customers enter every queue slot from directly behind it. Keeping the final
 * segment on +Z leaves the body and trolley facing the belt instead of along
 * the short end of the checkout.
 */
export function checkoutQueueArrival(slot: number, lane: CheckoutLane = 0): [StorePoint, StorePoint] {
  const destination = checkoutQueuePosition(slot, lane);
  return [[destination[0], destination[1] - CHECKOUT_QUEUE_SPACING], destination];
}

/**
 * Stationary customers in a checkout lane must not inherit the yaw of the
 * previous NavMesh segment. That segment can disappear from the render
 * snapshot on the exact tick in which the FSM enters a waiting state.
 *
 * The checkout counter remains the single source for the facing target, so a
 * lane move cannot leave the body or trolley looking away from its register.
 */
export function checkoutCustomerFacingYaw(
  customer: Pick<CustomerRuntimeState, "state" | "queueLane">,
  position: StorePoint,
): number | null {
  if (!CHECKOUT_CUSTOMER_FACING_STATES.has(customer.state)) return null;
  const counter = CHECKOUT_LANES[checkoutLaneOf(customer.queueLane)].counter;
  return Math.atan2(counter[0] - position[0], counter[2] - position[1]);
}

export function activeCheckoutForLane(transactions: readonly CheckoutTransaction[], lane: CheckoutLane) {
  return transactions.find((transaction) => (
    (transaction.checkoutLane ?? 0) === lane
    && transaction.state !== "COMPLETE"
    && transaction.state !== "ABANDONED"
  ));
}

/** A paid bag remains independent from the next transaction using the lane. */
export function checkoutHandoffForLane(
  transactions: readonly CheckoutTransaction[],
  lane: CheckoutLane,
  customers: readonly Pick<CustomerRuntimeState, "id" | "state" | "transactionId">[],
) {
  const handoffTransactionIds = new Set(customers
    .filter((customer) => customer.transactionId && ["NAVIGATE_TO_BAG", "TAKE_BAG"].includes(customer.state))
    .map((customer) => customer.transactionId));
  let fallback: CheckoutTransaction | undefined;
  for (const transaction of transactions) {
    if ((transaction.checkoutLane ?? 0) !== lane || transaction.state !== "COMPLETE" || !handoffTransactionIds.has(transaction.id)) continue;
    if (!fallback || transaction.updatedAt > fallback.updatedAt) fallback = transaction;
  }
  return fallback;
}

export function checkoutBagLocation(
  transaction: Pick<CheckoutTransaction, "id" | "customerId" | "state"> | null | undefined,
  customers: readonly Pick<CustomerRuntimeState, "id" | "state" | "transactionId">[],
): "counter" | "customer" | null {
  if (!transaction) return null;
  const customer = customers.find((candidate) => candidate.id === transaction.customerId && candidate.transactionId === transaction.id);
  return transaction.state === "COMPLETE" && customer?.transactionId === transaction.id && customer.state === "TAKE_BAG"
    ? "customer"
    : "counter";
}
