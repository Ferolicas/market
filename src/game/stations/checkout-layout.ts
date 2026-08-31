export type CheckoutLane = 0 | 1;
export type StorePoint = readonly [x: number, z: number];
export type StorePosition = readonly [x: number, y: number, z: number];

export interface CheckoutLaneLayout {
  counter: StorePosition;
  cashierWork: StorePosition;
  customerFront: StorePoint;
  bagPickup: StorePoint;
}

/**
 * One source of truth for checkout geometry and navigation.
 * Positive Z is the entrance side: cashiers stand there facing into the store,
 * while customers approach from the sales floor on the negative-Z side.
 */
export const CHECKOUT_LANES: Record<CheckoutLane, CheckoutLaneLayout> = {
  0: {
    counter: [7.55, 0, 3.95],
    cashierWork: [8.05, 0.018, 5.12],
    customerFront: [5.35, 2.85],
    bagPickup: [8.85, 2.85],
  },
  1: {
    counter: [7.55, 0, 0.95],
    cashierWork: [8.05, 0.018, 2.12],
    customerFront: [5.35, -0.15],
    bagPickup: [8.85, -0.15],
  },
};

export const CHECKOUT_CAMERA_TARGET: StorePosition = [6.8, 1.15, 3.3];
export const CHECKOUT_CAMERA_POSITION: StorePosition = [6.9, 3.65, 5.6];

export function checkoutQueuePosition(slot: number, lane: CheckoutLane = 0): [number, number] {
  const front = CHECKOUT_LANES[lane].customerFront;
  return [front[0], front[1] - slot * 0.78];
}
