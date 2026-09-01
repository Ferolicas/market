import { describe, expect, it } from "vitest";
import { CHECKOUT_CAMERA_FRAME, CHECKOUT_CAMERA_POSITION, CHECKOUT_CAMERA_TARGET, CHECKOUT_LANES, activeCheckoutForLane, checkoutBagLocation, checkoutHandoffForLane, checkoutQueueArrival, checkoutQueuePosition } from "./checkout-layout";
import type { CheckoutTransaction } from "../types";

describe("checkout layout", () => {
  it("places the cashier on the entrance side facing the store", () => {
    for (const lane of [0, 1] as const) {
      const layout = CHECKOUT_LANES[lane];
      expect(layout.cashierWork[2]).toBeGreaterThan(layout.counter[2]);
      expect(layout.customerFront[1]).toBeLessThan(layout.counter[2]);
      expect(Math.abs(layout.customerFront[0] - layout.counter[0])).toBeLessThan(1);
      expect(layout.bagPickup[1]).toBe(layout.customerFront[1]);
      expect(checkoutQueuePosition(1, lane)).toEqual(layout.queueStart);
      expect(checkoutQueuePosition(1, lane)[0]).toBeLessThan(layout.customerFront[0]);
      expect(checkoutQueuePosition(2, lane)[1]).toBeLessThan(layout.queueStart[1]);

      const [approach, destination] = checkoutQueueArrival(0, lane);
      expect(destination).toEqual(layout.customerFront);
      expect(approach[0]).toBe(destination[0]);
      expect(approach[1]).toBeLessThan(destination[1]);
    }
    expect(CHECKOUT_CAMERA_POSITION[2]).toBeGreaterThan(CHECKOUT_LANES[0].cashierWork[2]);
    expect(CHECKOUT_CAMERA_TARGET[2]).toBeLessThan(CHECKOUT_LANES[0].counter[2]);
    expect(CHECKOUT_CAMERA_TARGET[0]).toBeGreaterThan(CHECKOUT_LANES[0].counter[0]);
    expect(CHECKOUT_CAMERA_FRAME.width).toBeGreaterThanOrEqual(39);
    expect(CHECKOUT_CAMERA_FRAME.height).toBeGreaterThanOrEqual(27);
  });

  it("keeps a completed bag awaiting handoff independent from the next live checkout", () => {
    const transaction = (id: string, state: CheckoutTransaction["state"]): CheckoutTransaction => ({
      id, customerId: id, pendingItems: [], paymentMethod: "card", state, nextUnitIndex: 0,
      paymentCommitted: state === "COMPLETE", updatedAt: 0, lastLoadedAt: 0, lastScannedAt: 0, lastBaggedAt: 0, checkoutLane: 0,
    });
    const completed = transaction("old", "COMPLETE");
    const abandoned = transaction("abandoned", "ABANDONED");
    const live = transaction("live", "SCANNING");
    const handoffCustomer = { id: "old", state: "NAVIGATE_TO_BAG" as const, transactionId: "old" };
    const transactions = [completed, abandoned, live];

    expect(activeCheckoutForLane(transactions, 0)?.id).toBe("live");
    expect(activeCheckoutForLane([completed, abandoned], 0)).toBeUndefined();
    expect(checkoutHandoffForLane(transactions, 0, [handoffCustomer])?.id).toBe("old");
    expect(checkoutHandoffForLane([completed, abandoned], 0, [{ ...handoffCustomer, state: "TAKE_BAG" }])?.id).toBe("old");
    expect(checkoutHandoffForLane([completed, abandoned], 0, [{ ...handoffCustomer, state: "NAVIGATE_TO_CART_RETURN", transactionId: null }])).toBeUndefined();
    expect(activeCheckoutForLane(transactions, 1)).toBeUndefined();
    expect(checkoutHandoffForLane(transactions, 1, [handoffCustomer])).toBeUndefined();
  });

  it("moves a completed bag from the counter to the customer's hand without duplicating it", () => {
    const transaction: CheckoutTransaction = {
      id: "handoff", customerId: "customer", pendingItems: [], paymentMethod: "card", state: "COMPLETE", nextUnitIndex: 0,
      paymentCommitted: true, updatedAt: 10, lastLoadedAt: 1, lastScannedAt: 2, lastBaggedAt: 3, checkoutLane: 0,
    };
    const customer = { id: "customer", state: "NAVIGATE_TO_BAG" as const, transactionId: "handoff" };

    expect(checkoutBagLocation(transaction, [customer])).toBe("counter");
    expect(checkoutBagLocation(transaction, [{ ...customer, state: "TAKE_BAG" }])).toBe("customer");
    expect(checkoutBagLocation(undefined, [customer])).toBeNull();
  });
});
