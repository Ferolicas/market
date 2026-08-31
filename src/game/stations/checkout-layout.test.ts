import { describe, expect, it } from "vitest";
import { CHECKOUT_CAMERA_POSITION, CHECKOUT_CAMERA_TARGET, CHECKOUT_LANES, checkoutQueuePosition } from "./checkout-layout";

describe("checkout layout", () => {
  it("places the cashier on the entrance side facing the store", () => {
    for (const lane of [0, 1] as const) {
      const layout = CHECKOUT_LANES[lane];
      expect(layout.cashierWork[2]).toBeGreaterThan(layout.counter[2]);
      expect(layout.customerFront[1]).toBeLessThan(layout.counter[2]);
      expect(layout.bagPickup[1]).toBe(layout.customerFront[1]);
      expect(checkoutQueuePosition(1, lane)[1]).toBeLessThan(layout.customerFront[1]);
    }
    expect(CHECKOUT_CAMERA_POSITION[2]).toBeGreaterThan(CHECKOUT_LANES[0].cashierWork[2]);
    expect(CHECKOUT_CAMERA_TARGET[2]).toBeLessThan(CHECKOUT_LANES[0].counter[2]);
  });
});
