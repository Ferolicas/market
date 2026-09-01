import { describe, expect, it } from "vitest";
import { cartSteeringAngle, checkoutCartInventory, checkoutLoadingPresentation, easedMotionProgress, productTransferPoint, shortestHeadingDelta, wheelRollDelta } from "./CustomerCartMotion";

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
});
