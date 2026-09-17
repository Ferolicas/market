import { describe, expect, it } from "vitest";
import { CAMPAIGN_LOCATIONS, campaignBasketUnits, campaignCustomerLimit, campaignShoppingList } from "./CampaignLocations";
import { CAMPAIGN_TASK_IDS, campaignTaskStatus, campaignTaskTarget, purchaseTasks } from "./CampaignTasks";
import { PRODUCT_IDS } from "../economy/ProductRegistry";
import { MAX_SHOPPING_LINES, MAX_SHOPPING_LINE_UNITS } from "../ai/CustomerBrain";
import { applyGameAction, campaignPersonalTasks, createCampaignGame, normalizeGameState, advanceWorld } from "../engine";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import { OPENING_PURCHASES } from "./MartCampaign";
import { campaignExpansionQuote, campaignMasteryProgress } from "./CampaignExpansion";
import { campaignContracts } from "./CampaignContracts";

describe("location specialties", () => {
  it("measures whole-store mastery, including locked chains, without early 100 percent", () => {
    const state = createCampaignGame();
    const store = state.franchises[1];
    expect(campaignMasteryProgress(store)).toBe(0);
    store.purchases!.personalProgress = { "player:harvest:tomatoes": 16, "player:stock:tomatoes": 16 };
    expect(campaignMasteryProgress(store)).toBeLessThan(10);
    store.purchases!.purchased = OPENING_PURCHASES.map((item) => item.id);
    store.purchases!.personalProgress = Object.fromEntries(CAMPAIGN_TASK_IDS.map((id) => [id, campaignTaskTarget(id, store.id)]));
    expect(campaignMasteryProgress(store)).toBeLessThan(100);
    store.purchases!.completedContracts = campaignContracts(store).map((contract) => contract.id);
    expect(campaignMasteryProgress(store)).toBe(100);
    expect(campaignMasteryProgress(state.franchises[0])).toBe(0);
  });
  it("has distinct specialties with all personal targets within the save budget", () => {
    expect(new Set(Object.values(CAMPAIGN_LOCATIONS).map((profile) => profile.specialty)).size).toBe(6);
    for (const location of Object.keys(CAMPAIGN_LOCATIONS)) {
      for (const task of CAMPAIGN_TASK_IDS) {
        const target = campaignTaskTarget(task, location);
        expect(Number.isSafeInteger(target)).toBe(true);
        expect(target).toBeGreaterThan(0);
        expect(target).toBeLessThanOrEqual(100);
      }
    }
    expect(campaignTaskStatus("player:stock:coffee", {}, "estacion")).toMatchObject({ target: 12, label: "Repón tú 12 cafés" });
    expect(campaignTaskStatus("player:harvest:coffee", {}, "estacion")).toMatchObject({ target: 12, label: "Cosecha tú 12 cafés" });
    expect(campaignTaskTarget("player:stock:juice", "marina")).toBe(16);
    // Construction teaching gates stay short; local mastery is for expansion.
    expect(purchaseTasks("flour-mill-1")[0].target).toBe(6);
  });
  it("samples deterministically without locked products or duplicated lines", () => {
    for (const location of Object.keys(CAMPAIGN_LOCATIONS)) {
      for (let seed = 1; seed <= 500; seed++) {
        const available = ["coffee", "bread", "tomatoes"] as const;
        const list = campaignShoppingList(location, available, seed * 2654435761, 28);
        expect(list).toEqual(campaignShoppingList(location, available, seed * 2654435761, 28));
        expect(new Set(list.map((line) => line.productId)).size).toBe(list.length);
        expect(list.every((line) => available.includes(line.productId as typeof available[number]))).toBe(true);
        expect(list.reduce((sum, line) => sum + line.requested, 0)).toBeLessThanOrEqual(15);
      }
    }
    expect(campaignShoppingList("megastore", [], 2, 28)).toEqual([]);
    // Before the eggs open only tomatoes are on sale: one unit, sometimes two.
    for (let seed = 1; seed <= 100; seed++) {
      const list = campaignShoppingList("megastore", ["tomatoes"], seed, 3);
      expect(list).toHaveLength(1);
      expect([1, 2]).toContain(list[0].requested);
    }
  });

  it("buys four units spread over every product on sale once the eggs open", () => {
    expect(campaignBasketUnits(3)).toEqual({ base: 1, bonus: 1 });
    expect(campaignBasketUnits(4)).toEqual({ base: 4, bonus: 1 });
    expect(campaignBasketUnits(7)).toEqual({ base: 5, bonus: 1 });
    expect(campaignBasketUnits(28)).toEqual({ base: 12, bonus: 1 });
    for (let seed = 1; seed <= 300; seed++) {
      const list = campaignShoppingList("barrio", ["tomatoes", "eggs"], seed * 2654435761, 4);
      const units = list.reduce((sum, line) => sum + line.requested, 0);
      expect([4, 5]).toContain(units);
      // Both products on sale are always in the basket, in any distribution.
      expect(new Set(list.map((line) => line.productId))).toEqual(new Set(["tomatoes", "eggs"]));
    }
    for (let seed = 1; seed <= 300; seed++) {
      const list = campaignShoppingList("barrio", ["tomatoes", "eggs", "bread", "milk"], seed, 13);
      expect(list).toHaveLength(4);
      expect([7, 8]).toContain(list.reduce((sum, line) => sum + line.requested, 0));
    }
  });

  it("never asks for more than three units of a product or more than five products, whatever the level", () => {
    // Level 7 with two products on sale used to put four or more units on one
    // line, which the save schema refuses and which stopped every save.
    for (let seed = 1; seed <= 500; seed++) {
      const list = campaignShoppingList("barrio", ["tomatoes", "eggs"], seed * 2654435761, 7);
      expect(list.every((line) => line.requested >= 1 && line.requested <= MAX_SHOPPING_LINE_UNITS), `seed ${seed}`).toBe(true);
      expect([5, 6]).toContain(list.reduce((sum, line) => sum + line.requested, 0));
    }
    for (let seed = 1; seed <= 500; seed++) {
      const list = campaignShoppingList("megastore", PRODUCT_IDS, seed, 28);
      expect(list.length).toBeLessThanOrEqual(MAX_SHOPPING_LINES);
      expect(list.every((line) => line.requested <= MAX_SHOPPING_LINE_UNITS)).toBe(true);
      expect(list.reduce((sum, line) => sum + line.requested, 0)).toBeLessThanOrEqual(MAX_SHOPPING_LINES * MAX_SHOPPING_LINE_UNITS);
    }
  });

  it("adds one shopper every five levels up to eight", () => {
    expect([1, 2, 3, 4].map(campaignCustomerLimit)).toEqual([2, 2, 2, 2]);
    expect(campaignCustomerLimit(5)).toBe(3);
    expect(campaignCustomerLimit(10)).toBe(4);
    expect(campaignCustomerLimit(15)).toBe(5);
    expect(campaignCustomerLimit(29)).toBe(7);
    expect(campaignCustomerLimit(30)).toBe(8);
  });
  it("increases specialty demand while retaining every other available product", () => {
    const counts = Object.fromEntries(PRODUCT_IDS.map((id) => [id, 0]));
    for (let seed = 1; seed <= 4_000; seed++) {
      counts[campaignShoppingList("estacion", PRODUCT_IDS, seed * 2654435761, 28)[0].productId]++;
    }
    expect(Object.values(counts).every((count) => count > 0)).toBe(true);
    expect(counts.coffee).toBeGreaterThan(counts.tomatoes * 2);
    expect(counts.bread).toBeGreaterThan(counts.milk * 2);
  });
  it("records work beyond the old cap in the active store and validates reload", () => {
    const state = createCampaignGame();
    state.currentFranchiseId = "estacion";
    const local = state.franchises[1];
    local.owned = true;
    local.purchases!.purchased = OPENING_PURCHASES.map((item) => item.id);
    local.purchases!.personalProgress = { "player:stock:coffee": 3 };
    local.carry = { capacity: 3, items: { coffee: 3 } };
    const result = applyGameAction(state, { type: "STOCK", productId: "coffee", quantity: 3, source: "carry" });
    expect(result.ok).toBe(true);
    expect(result.state.franchises[1].purchases!.personalProgress!["player:stock:coffee"]).toBe(6);
    expect(result.state.franchises[0].purchases!.personalProgress ?? {}).toEqual({});
    expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
    const restored = normalizeGameState(JSON.parse(JSON.stringify(result.state)));
    expect(campaignPersonalTasks(restored).find((task) => task.id === "player:stock:coffee")).toMatchObject({ progress: 6, target: 12, completed: false });
    expect(campaignExpansionQuote(restored, "marina").tasks.find((task) => task.id === "player:stock:coffee")).toMatchObject({ progress: 6, target: 12, completed: false });
  });
  it("uses campaign demand independently of legacy XP level", () => {
    const state = createCampaignGame();
    state.franchises[0].open = true;
    state.franchises[0].purchases!.purchased = OPENING_PURCHASES.map((item) => item.id);
    const highLevel = structuredClone(state);
    highLevel.level = 30;
    const first = advanceWorld(state, 100).state.franchises[0].customers[0];
    const second = advanceWorld(highLevel, 100).state.franchises[0].customers[0];
    expect(first).toBeDefined();
    expect(first.shoppingList).toEqual(second.shoppingList);
  });
});
