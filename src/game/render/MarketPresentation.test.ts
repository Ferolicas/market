import { describe, expect, it } from "vitest";
import { createInitialGame } from "../engine";
import type { CheckoutTransaction, CustomerRuntimeState } from "../types";
import { cropPresentationStage, sameFarmPresentation, sameFurniturePresentation } from "./MarketPresentation";

function fixture() {
  const game = createInitialGame();
  const franchise = game.franchises[0];
  return { game, franchise };
}

describe("market presentation reconciliation", () => {
  it("ignores world motion snapshots that cannot change a fixture", () => {
    const { franchise } = fixture();
    const customer = {
      id: "customer-1",
      state: "NAVIGATE_TO_PRODUCT",
      transactionId: null,
      currentLine: 0,
      shoppingList: [{ productId: "tomatoes", requested: 2, picked: 0 }],
      x: 1,
      z: 1,
    } as CustomerRuntimeState;
    const moved = { ...customer, x: 7, z: -4, pathIndex: 3, patienceMs: 12_000 };
    const base = {
      shelves: franchise.shelves,
      machines: franchise.productionMachines,
      customers: [customer],
      checkoutTransactions: franchise.checkoutTransactions,
      returnsBin: franchise.returnsBin,
      returnedCartCount: franchise.returnedCartCount,
      lightsOn: franchise.lightsOn,
      unlockedAreas: franchise.unlockedAreas,
    };
    expect(sameFurniturePresentation(base, { ...base, customers: [moved] })).toBe(true);
  });

  it("invalidates furniture for cold-door and checkout unit transitions", () => {
    const { franchise } = fixture();
    const customer = {
      id: "customer-1",
      state: "NAVIGATE_TO_PRODUCT",
      transactionId: "checkout-1",
      currentLine: 0,
      shoppingList: [{ productId: "milk", requested: 1, picked: 0 }],
    } as CustomerRuntimeState;
    const transaction = {
      id: "checkout-1",
      customerId: customer.id,
      state: "SCANNING",
      checkoutLane: 0,
      updatedAt: 10,
      pendingItems: [{ productId: "milk", quantity: 1, loaded: 1, scanned: 0, bagged: 0 }],
    } as CheckoutTransaction;
    const base = {
      shelves: franchise.shelves,
      machines: franchise.productionMachines,
      customers: [customer],
      checkoutTransactions: [transaction],
      returnsBin: franchise.returnsBin,
      returnedCartCount: franchise.returnedCartCount,
      lightsOn: franchise.lightsOn,
      unlockedAreas: franchise.unlockedAreas,
    };
    expect(sameFurniturePresentation(base, { ...base, customers: [{ ...customer, state: "PICK_PRODUCT" }] })).toBe(false);
    expect(sameFurniturePresentation(base, {
      ...base,
      checkoutTransactions: [{ ...transaction, pendingItems: [{ ...transaction.pendingItems[0], scanned: 1 }] }],
    })).toBe(false);
  });

  it("reconciles growing plots only when their authored visual stage changes", () => {
    const { franchise } = fixture();
    const crop = { ...franchise.crops[0], status: "GROWING" as const, plantedAt: 0, readyAt: 4_000 };
    const base = { crops: [crop], machines: franchise.productionMachines, nowMs: 200, unlockedAreas: franchise.unlockedAreas };
    expect(cropPresentationStage(crop, 200)).toBe(0);
    expect(sameFarmPresentation(base, { ...base, nowMs: 900 })).toBe(true);
    expect(cropPresentationStage(crop, 1_100)).toBe(1);
    expect(sameFarmPresentation(base, { ...base, nowMs: 1_100 })).toBe(false);
  });
});
