import { describe, expect, it } from "vitest";
import { advanceWorld, createInitialGame, normalizeGameState } from "../engine";
import type { CustomerRuntimeState } from "../types";
import { createCustomerMind } from "./CustomerBrain";
import { CUSTOMER_PATIENCE_MS, customerShowingAnger } from "./CustomerPatience";

function waitingGame() {
  const state = createInitialGame();
  state.franchises[0].open = true;
  state.franchises[0].shelves.tomatoes = 0;
  state.simulationTimeMs = 119_800;
  const customer: CustomerRuntimeState = {
    ...createCustomerMind("waiting", ["tomatoes"], 1, 1),
    identity: 1, state: "WAIT_RESTOCK", shoppingList: [{ productId: "tomatoes", requested: 2, picked: 0 }],
    waitingSince: 0, stateSince: 0, checkoutPatienceMs: 300_000, transactionId: null,
    hasCart: true, hasBag: false, angry: false, x: -4, z: 0, targetX: -4, targetZ: 0,
    path: [], pathIndex: 0, speed: 1.4, currentSpeed: 0, reservedSocketId: "tomatoes:0",
    blockedSince: null, routeFailures: 0,
  };
  state.franchises[0].customers = [customer];
  return state;
}

describe("two-minute customer patience", () => {
  it("gives new and restored customers the same two-minute allowance", () => {
    expect(createCustomerMind("new", ["tomatoes"], 1, 1).patienceMs).toBe(CUSTOMER_PATIENCE_MS);
    const state = waitingGame();
    state.franchises[0].customers[0].patienceMs = 12_000;
    expect(normalizeGameState(state).franchises[0].customers[0]).toMatchObject({ patienceMs: 120_000, checkoutPatienceMs: 120_000 });
  });

  it.each([false, true])("leaves angry at exactly 120 seconds, returning any unpaid goods (%s)", (hasGoods) => {
    let state = waitingGame();
    if (hasGoods) state.franchises[0].customers[0].basket.apples = 1;
    const money = state.balanceMinor;
    state = advanceWorld(state, 100).state;
    expect(state.franchises[0].customers[0].angry).toBe(false);
    state = advanceWorld(state, 100).state;
    const customer = state.franchises[0].customers[0];
    expect(customer).toMatchObject({ angry: true, state: "NAVIGATE_TO_RETURNS", reservedSocketId: null });
    expect(customerShowingAnger(customer, state.simulationTimeMs)).toBe(true);
    const position = [customer.x, customer.z];
    state = advanceWorld(state, 1_000).state;
    expect([state.franchises[0].customers[0].x, state.franchises[0].customers[0].z]).toEqual(position);
    expect(customerShowingAnger(customer, customer.stateSince + 1_500)).toBe(false);
    for (let i = 0; i < 60; i++) state = advanceWorld(state, 1_000).state;
    expect(state.franchises[0].customers.find((c) => c.id === "waiting")).toBeUndefined();
    expect(state.franchises[0].returnsBin.apples).toBe(hasGoods ? 1 : 0);
    expect(state.balanceMinor).toBe(money);
  });

  it("does not reset the deadline when stock appears but has not been picked", () => {
    let state = waitingGame();
    state.franchises[0].shelves.tomatoes = 1;
    state = advanceWorld(state, 100).state;
    expect(state.franchises[0].customers[0].waitingSince).toBe(0);
    state = advanceWorld(state, 100).state;
    expect(state.franchises[0].customers[0].angry).toBe(true);
  });

  it("clears the deadline after successfully completing the product", () => {
    let state = waitingGame();
    const customer = state.franchises[0].customers[0];
    customer.state = "PICK_PRODUCT";
    customer.shoppingList[0].requested = 1;
    state.franchises[0].shelves.tomatoes = 1;
    state = advanceWorld(state, 100).state;
    expect(state.franchises[0].customers[0]).toMatchObject({ waitingSince: null, angry: false, basket: { tomatoes: 1 } });
  });
});
