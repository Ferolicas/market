import { describe, expect, it } from "vitest";
import { CHECKOUT_CAMERA_FRAME, CHECKOUT_CAMERA_POSITION, CHECKOUT_CAMERA_TARGET, CHECKOUT_LANE_IDS, CHECKOUT_LANES, activeCheckoutForLane, checkoutAreaForLane, checkoutBagLocation, checkoutCustomerFacingYaw, checkoutHandoffForLane, checkoutLaneOf, checkoutQueueArrival, checkoutQueuePosition, openCheckoutLaneCount } from "./checkout-layout";
import type { CheckoutTransaction, CustomerRuntimeState } from "../types";
import { checkoutParkedCart } from "./checkout-layout";
import { RETAIL_DEPARTMENTS } from "./retail-layout";
import { STORE_REAR_DOOR } from "./storefront-layout";
import { ensureStoreNavigation, isStoreNavigationPoint, storePathfinder } from "../navigation/NavMeshService";

/** Every area that adds furniture, so the tills are checked in the fullest store. */
const FULLY_OPENED_STORE = ["purchase-campaign", "checkout-2", "checkout-3", "expansion-side", "flour-mill", "bread-oven", "cheese-maker", "juice-machine",
  "chicken-coop", "chicken-coop-2", "cow-station", "corn-canner", "preserves-supply", "coffee-supply", "farm-wheat", "egg-display", "dairy-display"];

describe("checkout layout", () => {
  it("parks the trolley beside the customer, away from every counter", () => {
    for (const queueLane of CHECKOUT_LANE_IDS) {
      const lane = CHECKOUT_LANES[queueLane];
      for (const state of ["UNLOAD", "WAIT_CHECKOUT", "PAY"] as const) {
        const point = checkoutParkedCart({ state, queueLane, queueSlot: 0, x: lane.customerFront[0], z: lane.customerFront[1] })!;
        expect(point[0]).toBeGreaterThan(lane.customerFront[0] + 0.8);
        expect(point[1]).toBeLessThan(lane.customerFront[1]);
        expect(lane.counter[2] - point[1]).toBeGreaterThan(1.4);
      }
      expect(checkoutParkedCart({ state: "EXIT_STORE", queueLane, queueSlot: null, x: 0, z: 8 })).toBeNull();
    }
  });
  it("places the cashier on the entrance side facing the store", () => {
    for (const lane of CHECKOUT_LANE_IDS) {
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
    expect(CHECKOUT_CAMERA_TARGET[0]).toBeLessThan(CHECKOUT_LANES[0].counter[0]);
    expect(CHECKOUT_CAMERA_FRAME.width).toBe(10);
    expect(CHECKOUT_CAMERA_FRAME.height).toBe(10);
  });

  it("faces every stationary queue and payment pose toward its own register", () => {
    const checkoutStates: CustomerRuntimeState["state"][] = ["QUEUE_WAIT", "UNLOAD", "WAIT_CHECKOUT", "PAY"];
    for (const lane of CHECKOUT_LANE_IDS) {
      for (let slot = 0; slot < 6; slot += 1) {
        const position = checkoutQueuePosition(slot, lane);
        const counter = CHECKOUT_LANES[lane].counter;
        const expected = Math.atan2(counter[0] - position[0], counter[2] - position[1]);
        for (const state of checkoutStates) {
          expect(checkoutCustomerFacingYaw({ state, queueLane: lane }, position)).toBeCloseTo(expected);
        }
      }
    }
  });

  it("opens the tills in order and falls back to the first lane for unknown values", () => {
    expect(openCheckoutLaneCount([])).toBe(1);
    expect(openCheckoutLaneCount(["checkout-2"])).toBe(2);
    expect(openCheckoutLaneCount(["checkout-3"])).toBe(1);
    expect(openCheckoutLaneCount(["checkout-3", "checkout-2"])).toBe(3);
    expect(CHECKOUT_LANE_IDS.map(checkoutAreaForLane)).toEqual(["checkout-1", "checkout-2", "checkout-3"]);
    expect(checkoutLaneOf(2)).toBe(2);
    expect(checkoutLaneOf(undefined)).toBe(0);
    expect(checkoutLaneOf(7)).toBe(0);
  });

  it("stacks the tills in one column and keeps the third queue off the drinks service point", () => {
    for (const lane of CHECKOUT_LANE_IDS) {
      expect(CHECKOUT_LANES[lane].counter[0]).toBe(CHECKOUT_LANES[0].counter[0]);
      if (lane > 0) expect(CHECKOUT_LANES[lane - 1 as 0 | 1].counter[2] - CHECKOUT_LANES[lane].counter[2]).toBeCloseTo(3);
    }
    const drinks = RETAIL_DEPARTMENTS.drinks.service;
    for (let slot = 0; slot < 6; slot += 1) {
      const point = checkoutQueuePosition(slot, 2);
      expect(Math.hypot(point[0] - drinks[0], point[1] - drinks[1]), `slot ${slot} crowds the drinks shopper`).toBeGreaterThanOrEqual(1);
      expect(Math.hypot(point[0] - STORE_REAR_DOOR.insideApproach[0], point[1] - STORE_REAR_DOOR.insideApproach[1]), `slot ${slot} blocks the rear door`).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps every till's sockets walkable and reachable in the fully opened store", async () => {
    expect(await ensureStoreNavigation(FULLY_OPENED_STORE)).toBe(true);
    const entrance: [number, number] = [0, 6.5];
    // Recast ends a path at the centre of the nearest walkable cell, up to
    // ~0.6 layout units from an authored socket beside furniture; a socket
    // that is really walled off ends a unit or more away.
    const reaches = (from: [number, number], to: [number, number], label: string) => {
      const path = storePathfinder(from, to);
      expect(path.length, `${label}: no path`).toBeGreaterThan(0);
      expect(Math.hypot(path.at(-1)![0] - to[0], path.at(-1)![1] - to[1]), `${label}: path stops short`).toBeLessThan(0.65);
    };
    for (const lane of CHECKOUT_LANE_IDS) {
      const layout = CHECKOUT_LANES[lane];
      const cashierWork: [number, number] = [layout.cashierWork[0], layout.cashierWork[2]];
      const sockets: [string, [number, number]][] = [
        ["cashier work", cashierWork], ["customer front", [...layout.customerFront]], ["bag pickup", [...layout.bagPickup]],
        ...Array.from({ length: 3 }, (_, slot) => [`queue slot ${slot + 1}`, checkoutQueuePosition(slot + 1, lane)] as [string, [number, number]]),
      ];
      for (const [label, point] of sockets) {
        expect(isStoreNavigationPoint(point, FULLY_OPENED_STORE), `lane ${lane} ${label} sits inside furniture`).toBe(true);
        reaches(entrance, point, `lane ${lane} ${label} from the entrance`);
        reaches(point, entrance, `lane ${lane} ${label} back to the entrance`);
      }
      // The counter itself is solid for everyone.
      expect(isStoreNavigationPoint([layout.counter[0], layout.counter[2]], FULLY_OPENED_STORE)).toBe(false);
    }
    // Shoppers at the drinks display and workers heading for the rear door keep their paths.
    reaches(entrance, [...RETAIL_DEPARTMENTS.drinks.service], "drinks service point");
    reaches(entrance, [...STORE_REAR_DOOR.insideApproach], "rear door approach");
    reaches([...CHECKOUT_LANES[2].bagPickup], [...STORE_REAR_DOOR.insideApproach], "third lane to the rear door");
  });

  it("leaves moving customers under NavMesh heading control", () => {
    for (const state of ["NAVIGATE_TO_QUEUE", "MOVE_QUEUE", "NAVIGATE_TO_BAG"] as const) {
      expect(checkoutCustomerFacingYaw({ state, queueLane: 0 }, CHECKOUT_LANES[0].customerFront)).toBeNull();
    }
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
