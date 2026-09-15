import type { CustomerRuntimeState } from "../types";

export const CUSTOMER_PATIENCE_MS = 120_000;
export const CUSTOMER_ANGRY_REACTION_MS = 1_500;

/** Shared by simulation and presentation: stop before playing the existing clip. */
export function customerShowingAnger(customer: CustomerRuntimeState, now: number) {
  return customer.angry && customer.state === "NAVIGATE_TO_RETURNS"
    && now - customer.stateSince < CUSTOMER_ANGRY_REACTION_MS;
}
