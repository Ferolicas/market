import type { CustomerRuntimeState } from "../types";

export function customerWalkSpeed(identity: number) {
  return (1.2 + identity * 0.045) * 1.4;
}

const FINISHING_SHOPPING = new Set<CustomerRuntimeState["state"]>([
  "NAVIGATE_TO_QUEUE", "MOVE_QUEUE", "QUEUE_WAIT", "UNLOAD", "WAIT_CHECKOUT", "PAY",
  "NAVIGATE_TO_BAG", "TAKE_BAG", "NAVIGATE_TO_RETURNS", "LEAVE_RETURNS",
  "NAVIGATE_TO_CART_RETURN", "RETURN_CART", "EXIT_STORE", "DESPAWN",
]);

/** Incoming shoppers reserve their place; checkout/departure opens a new one.
 * A bounded overlap prevents an unattended till generating an endless crowd. */
export function campaignNeedsCustomer(customers: readonly CustomerRuntimeState[], target: number) {
  const live = customers.filter((customer) => customer.state !== "DESPAWN");
  const shoppingOrEntering = live.filter((customer) => !FINISHING_SHOPPING.has(customer.state)).length;
  return shoppingOrEntering < target && live.length < Math.min(30, target * 3);
}
