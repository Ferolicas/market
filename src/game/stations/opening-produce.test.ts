import { describe, expect, it } from "vitest";
import { applyGameAction, createCampaignGame, normalizeGameState } from "../engine";
import { departmentStockingPulses } from "../player/CarrySystem";
import { fixtureAvailable } from "./fixture-availability";
import { distributedFixtureQuantity, retailFixtureDisplayPositions, retailShelfCapacityForTier, retailStockFixtureSlot, retailStockingMagnets } from "./retail-layout";

describe("one produce display at the campaign opening", () => {
  it("uses one fixture, one magnet and fifteen tomato slots before expansion", () => {
    const state = createCampaignGame();
    const franchise = state.franchises[0];
    expect(franchise.crops.filter((crop) => crop.status !== "LOCKED")).toHaveLength(1);
    expect(retailFixtureDisplayPositions("produce", franchise.unlockedAreas)).toHaveLength(1);
    expect(retailStockingMagnets("produce", 2, 1.6, franchise.unlockedAreas)).toHaveLength(1);
    expect(fixtureAvailable("fixture:retail-produce-2", franchise.unlockedAreas)).toBe(false);
    expect(retailShelfCapacityForTier(1, "tomatoes", franchise.unlockedAreas)).toBe(15);
    expect(retailShelfCapacityForTier(10, "tomatoes", franchise.unlockedAreas)).toBe(30);
    for (let ordinal = 0; ordinal < 15; ordinal++) {
      expect(retailStockFixtureSlot("produce", ordinal, 15, franchise.unlockedAreas)).toEqual({ fixtureIndex: 0, localOrdinal: ordinal, localEnd: 15 });
    }
  });
  it("keeps excess in the basket and preserves every tomato through expansion and reload", () => {
    let state = createCampaignGame();
    state.franchises[0].shelves.tomatoes = 14;
    state.franchises[0].carry.items.tomatoes = 3;
    const franchise = state.franchises[0];
    expect(departmentStockingPulses(franchise.carry, franchise.shelves, 1, ["tomatoes"], franchise.unlockedAreas)).toEqual([{ productId: "tomatoes", quantity: 1 }]);
    const stocked = applyGameAction(state, { type: "STOCK", productId: "tomatoes", quantity: 3, source: "carry" });
    expect(stocked.ok).toBe(true);
    expect(stocked.state.franchises[0].shelves.tomatoes).toBe(15);
    expect(stocked.state.franchises[0].carry.items.tomatoes).toBe(2);
    state = normalizeGameState(JSON.parse(JSON.stringify(stocked.state)));
    state.balanceMinor = 100_000;
    // This layout fixture starts with the expansion's personal tasks completed.
    state.franchises[0].purchases!.personalProgress = { "player:harvest:tomatoes": 8, "player:stock:tomatoes": 8, "player:feed:chicken": 4, "player:stock:eggs": 4 };
    for (const purchaseId of ["farmer-1", "egg-display-1", "chicken-1", "tomato-2", "farmer-2", "expansion-1"] as const) {
      const result = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId, amountMinor: 100_000 });
      expect(result.ok).toBe(true);
      state = result.state;
    }
    const expanded = normalizeGameState(JSON.parse(JSON.stringify(state))).franchises[0];
    expect(retailFixtureDisplayPositions("produce", expanded.unlockedAreas)).toHaveLength(2);
    expect(retailStockingMagnets("produce", 2, 1.6, expanded.unlockedAreas)).toHaveLength(2);
    expect(retailShelfCapacityForTier(1, "tomatoes", expanded.unlockedAreas)).toBe(30);
    expect(expanded.shelves.tomatoes).toBe(15);
    expect(expanded.carry.items.tomatoes).toBe(2);
    expect([0, 1].map((index) => distributedFixtureQuantity(15, index, 2))).toEqual([8, 7]);
    expect(departmentStockingPulses(expanded.carry, expanded.shelves, 1, ["tomatoes"], expanded.unlockedAreas)).toEqual([{ productId: "tomatoes", quantity: 2 }]);
  });
});
