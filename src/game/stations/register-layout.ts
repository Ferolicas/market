import { CHECKOUT_LANES, type CheckoutLane } from "./checkout-layout";

export const REGISTER_INTERACTION_IDS = ["register-0", "register-1"] as const;
export type RegisterInteractionId = (typeof REGISTER_INTERACTION_IDS)[number];

export function isRegisterInteractionId(id: string): id is RegisterInteractionId {
  return id === "register-0" || id === "register-1";
}

export function registerLane(id: RegisterInteractionId): CheckoutLane {
  return id === "register-1" ? 1 : 0;
}

/** Beside the cashier mat, not on the cashier's reserved workstation. */
export function registerPickupPosition(lane: CheckoutLane): [number, number, number] {
  const [x, , z] = CHECKOUT_LANES[lane].cashierWork;
  return [x - 1.25, 0.06, z];
}
