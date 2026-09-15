import { describe, expect, it } from "vitest";
import { advanceWorld, createCampaignGame, normalizeGameState } from "../engine";
import { campaignNeedsCustomer, customerWalkSpeed } from "./CustomerTraffic";
import type { CustomerRuntimeState } from "../types";

function twoCustomers() {
  let state = createCampaignGame();
  state.franchises[0].open = true;
  state = advanceWorld(state, 200).state;
  return advanceWorld(state, 200).state;
}

describe("continuous customer arrivals", () => {
  it("keeps at least two shoppers inside after warm-up during three minutes of checkout service", () => {
    let state = twoCustomers();
    let sales = 0;
    for (let tick = 0; tick < 900; tick++) {
      state.franchises[0].shelves.tomatoes = 15;
      const result = advanceWorld(state, 200, undefined, { interactions: [{ type: "CHECKOUT", paymentMethod: "cash" }] });
      state = result.state;
      sales += result.events.filter((event) => event.category === "sales").length;
      const customers = state.franchises[0].customers;
      expect(customers.filter((c) => c.state !== "DESPAWN").length).toBeLessThanOrEqual(6);
      if (tick > 150) expect(customers.filter((c) => c.z < 7.25 && c.state !== "DESPAWN").length).toBeGreaterThanOrEqual(2);
    }
    expect(sales).toBeGreaterThan(5);
  });
  it("starts two entrants immediately without the old three-second gap", () => {
    const state = twoCustomers();
    expect(state.franchises[0].customers).toHaveLength(2);
    expect(new Set(state.franchises[0].customers.map((c) => c.id)).size).toBe(2);
    expect(advanceWorld(state, 200).state.franchises[0].customers).toHaveLength(2);
  });

  it.each(["NAVIGATE_TO_QUEUE", "WAIT_CHECKOUT", "PAY", "EXIT_STORE"] as const)("admits a replacement before the %s customer leaves", (phase) => {
    const state = twoCustomers();
    const customer = state.franchises[0].customers[0];
    customer.state = phase;
    customer.basket = { tomatoes: 1 };
    const next = advanceWorld(state, 200).state;
    expect(next.franchises[0].customers).toHaveLength(3);
    expect(next.franchises[0].customers.some((c) => c.id === customer.id)).toBe(true);
    expect(next.franchises[0].customers[2].state).toBe("ENTER_STORE");
    expect(advanceWorld(next, 200).state.franchises[0].customers).toHaveLength(3);
  });

  it("does not spawn while closed or grow an unbounded unattended checkout queue", () => {
    expect(advanceWorld(createCampaignGame(), 200).state.franchises[0].customers).toHaveLength(0);
    const customers: CustomerRuntimeState[] = Array.from({ length: 6 }, (_, i) => ({ ...twoCustomers().franchises[0].customers[0], id: `queued-${i}`, state: "WAIT_CHECKOUT" }));
    expect(campaignNeedsCustomer(customers, 2)).toBe(false);
    customers[0].state = "DESPAWN";
    expect(campaignNeedsCustomer(customers, 2)).toBe(true);
  });

  it("raises every identity's speed exactly 40% and restores without compounding", () => {
    for (let id = 1; id <= 6; id++) expect(customerWalkSpeed(id)).toBeCloseTo((1.2 + id * 0.045) * 1.4);
    const state = twoCustomers();
    state.franchises[0].customers[0].speed = 1.245;
    const restored = normalizeGameState(state);
    expect(restored.franchises[0].customers[0].speed).toBeCloseTo(1.743);
    expect(normalizeGameState(restored).franchises[0].customers[0].speed).toBeCloseTo(1.743);
  });
});
