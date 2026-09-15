import { describe, expect, it } from "vitest";
import {
  collectOpeningRegister, createOpeningCampaign, creditOpeningRegister,
  fundOpeningPurchase, OPENING_FARMER_STATS, OPENING_PURCHASES,
  openingAvailability, openingEconomyIsConserved, openingPlayerStats,
  openingPurchaseCost, openingPurchaseQuote,
} from "./MartCampaign";

describe("documented opening campaign", () => {
  it("starts with no free cash, tomato demand and two customers", () => {
    const state = createOpeningCampaign();
    expect(state.walletMinor).toBe(0);
    expect(openingAvailability(state)).toMatchObject({ products: ["tomatoes"], customerLimit: 2, tomatoYield: 8, tomatoSaleMinor: 100, eggSaleMinor: 200 });
    expect(openingPlayerStats(state)).toEqual({ capacity: 3, maximumSpeedRatio: 0.7 });
  });

  it.each([
    ["cashier-1", 6_800], ["egg-display-1", 6_800], ["chicken-1", 10_200],
    ["player-2", 10_200], ["farmer-1", 20_400], ["tomato-2", 10_200],
    ["tomato-3", 17_850], ["chicken-1-tier-2", 20_400],
  ] as const)("quotes %s using the supplied relative price", (id, amount) => {
    expect(openingPurchaseCost(id, "ES")).toBe(amount);
    expect(Number.isSafeInteger(openingPurchaseCost(id, "CO"))).toBe(true);
  });

  it("uses the authorized original tier-three price without bypassing dependencies", () => {
    expect(openingPurchaseCost("chicken-1-tier-3", "ES")).toBe(30_600);
    expect(openingPurchaseQuote(createOpeningCampaign(), "chicken-1-tier-3", "ES").available).toBe(false);
  });

  it("has a reachable dependency graph through cows and cheese without free purchases", () => {
    let state = collectOpeningRegister(creditOpeningRegister(createOpeningCampaign(), 10_000_000));
    for (const purchase of OPENING_PURCHASES) {
      expect(openingPurchaseQuote(state, purchase.id, "ES").available).toBe(true);
      expect(openingPurchaseCost(purchase.id, "ES")).toBeGreaterThan(0);
      state = fundOpeningPurchase(state, purchase.id, "ES", 10_000_000);
    }
    expect(state.purchased).toHaveLength(OPENING_PURCHASES.length);
    expect(state.purchased).toContain("cheese-maker-1");
    expect(openingEconomyIsConserved(state)).toBe(true);
  });

  it("requires collecting till money before funding any purchase", () => {
    const initial = createOpeningCampaign();
    const sold = creditOpeningRegister(initial, 3_000);
    expect(sold.walletMinor).toBe(0);
    expect(sold.registerMinor).toBe(3_000);
    expect(fundOpeningPurchase(sold, "cashier-1", "ES", 3_000)).toEqual(sold);
    const funded = fundOpeningPurchase(collectOpeningRegister(sold), "cashier-1", "ES", 3_000);
    expect(openingPurchaseQuote(funded, "cashier-1", "ES").remainingMinor).toBe(3_800);
    expect(openingEconomyIsConserved(funded)).toBe(true);
    expect(initial.registerMinor).toBe(0);
  });

  it("does not spend more than the remaining cost or buy an item twice", () => {
    const rich = collectOpeningRegister(creditOpeningRegister(createOpeningCampaign(), 10_000));
    const funded = fundOpeningPurchase(rich, "cashier-1", "ES", 10_000);
    expect(funded.walletMinor).toBe(3_200);
    expect(funded.purchased).toEqual(["cashier-1"]);
    expect(fundOpeningPurchase(funded, "cashier-1", "ES", 10_000)).toBe(funded);
    expect(collectOpeningRegister(funded)).toBe(funded);
  });

  it("persists exact partial funding without rounding or releasing the item", () => {
    const state = fundOpeningPurchase(collectOpeningRegister(creditOpeningRegister(createOpeningCampaign(), 3_000)), "cashier-1", "ES", 3_000);
    const restored = JSON.parse(JSON.stringify(state));
    expect(openingPurchaseQuote(restored, "cashier-1", "ES")).toMatchObject({ contributedMinor: 3_000, remainingMinor: 3_800, completed: false });
    expect(openingEconomyIsConserved(restored)).toBe(true);
  });

  it("unlocks eggs only after buying the display and chicken, then offers the farmer", () => {
    let state = collectOpeningRegister(creditOpeningRegister(createOpeningCampaign(), 100_000));
    expect(fundOpeningPurchase(state, "chicken-1", "ES", 100_000)).toBe(state);
    state = fundOpeningPurchase(state, "cashier-1", "ES", 100_000);
    state = fundOpeningPurchase(state, "egg-display-1", "ES", 100_000);
    expect(openingAvailability(state).products).toEqual(["tomatoes"]);
    state = fundOpeningPurchase(state, "chicken-1", "ES", 100_000);
    expect(openingAvailability(state).products).toEqual(["tomatoes", "eggs"]);
    expect(openingAvailability(state).expansionAvailable).toBe(false);
    state = fundOpeningPurchase(state, "farmer-1", "ES", 100_000);
    expect(openingAvailability(state).expansionAvailable).toBe(true);
    expect(openingAvailability(state).customerLimit).toBe(2);
  });

  it("upgrades player capacity and speed together while farmer never feeds", () => {
    let state = collectOpeningRegister(creditOpeningRegister(createOpeningCampaign(), 100_000));
    for (const id of ["cashier-1", "egg-display-1", "player-2"] as const) state = fundOpeningPurchase(state, id, "ES", 100_000);
    expect(openingPlayerStats(state).capacity).toBe(4);
    expect(openingPlayerStats(state).maximumSpeedRatio).toBeCloseTo(0.721);
    expect(OPENING_FARMER_STATS).toMatchObject({ capacity: 3, feedsAnimals: false });
    expect(OPENING_FARMER_STATS.maximumPlayerSpeedRatio).toBeCloseTo(0.49);
  });

  it.each([NaN, Infinity, -1, 0.5])("rejects invalid monetary pulses (%s)", (amount) => {
    const state = collectOpeningRegister(creditOpeningRegister(createOpeningCampaign(), 10_000));
    expect(creditOpeningRegister(state, amount)).toBe(state);
    expect(collectOpeningRegister(state, amount)).toBe(state);
    expect(fundOpeningPurchase(state, "cashier-1", "ES", amount)).toBe(state);
  });

  it("conserves every cent across 2000 deterministic mixed operations and reloads", () => {
    let state = createOpeningCampaign();
    let seed = 54321;
    for (let index = 0; index < 2_000; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const amount = seed % 2_000;
      state = index % 3 === 0 ? creditOpeningRegister(state, amount)
        : index % 3 === 1 ? collectOpeningRegister(state, amount)
          : fundOpeningPurchase(state, OPENING_PURCHASES[seed % OPENING_PURCHASES.length].id, "ES", amount);
      if (index % 11 === 0) state = JSON.parse(JSON.stringify(state));
      expect(openingEconomyIsConserved(state)).toBe(true);
      expect(new Set(state.purchased).size).toBe(state.purchased.length);
    }
  });
});
