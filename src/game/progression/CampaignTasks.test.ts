import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, campaignPersonalTasks, campaignPurchaseQuotes, createCampaignGame, normalizeGameState } from "../engine";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import type { GameAction, GameEvent } from "../types";
import { CAMPAIGN_TASK_IDS, campaignTaskStatus, PURCHASE_TASK_REQUIREMENTS } from "./CampaignTasks";
import { OPENING_PURCHASES, type OpeningPurchaseId } from "./MartCampaign";
import { createPurchaseState } from "./PurchaseState";

describe("personal campaign work", () => {
  it("keeps personal work local to each store rather than inheriting global counters", () => {
    let state = createCampaignGame();
    const other = state.franchises[1];
    other.owned = true;
    other.purchases = createPurchaseState();
    other.unlockedAreas.push("purchase-campaign");
    for (const franchise of [state.franchises[0], other]) {
      state.currentFranchiseId = franchise.id;
      const active = state.franchises.find((candidate) => candidate.id === franchise.id)!;
      active.shelves.tomatoes = 0;
      active.carry.items = { tomatoes: 3 };
      const result = applyGameAction(state, { type: "STOCK", productId: "tomatoes", quantity: 3, source: "carry" });
      expect(result.ok).toBe(true);
      expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
      state = result.state;
    }
    expect(state.progression.counters["player:stock:tomatoes"]).toBe(6);
    expect(state.franchises[0].purchases!.personalProgress!["player:stock:tomatoes"]).toBe(3);
    expect(state.franchises[1].purchases!.personalProgress!["player:stock:tomatoes"]).toBe(3);
  });
  it("makes every gating task's product available before the gated purchase", () => {
    for (const purchase of OPENING_PURCHASES) {
      const prerequisites = new Set<OpeningPurchaseId>();
      const include = (id: OpeningPurchaseId) => {
        if (prerequisites.has(id)) return;
        prerequisites.add(id);
        OPENING_PURCHASES.find((candidate) => candidate.id === id)!.requires.forEach(include);
      };
      purchase.requires.forEach(include);
      const state = createCampaignGame();
      state.franchises[0].purchases!.purchased = [...prerequisites];
      const available = campaignPersonalTasks(state).map((task) => task.id);
      for (const id of PURCHASE_TASK_REQUIREMENTS[purchase.id] ?? []) expect(available, purchase.id).toContain(id);
    }
  });
  it("cannot buy expansion with money, global totals or employee work alone", () => {
    let state = createCampaignGame();
    state.balanceMinor = 1_000_000;
    for (const purchaseId of ["cashier-1", "egg-display-1", "chicken-1", "farmer-1"] as const) {
      state = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId, amountMinor: 100_000 }).state;
    }
    for (let tick = 0; tick < 1_000; tick++) state = advanceWorld(state, 100).state;
    expect(state.franchises[0].shelves.tomatoes).toBeGreaterThan(0);
    state.level = 30;
    state.progression.counters["stock:eggs"] = 999;
    state.progression.counters["feed:chicken"] = 999;
    expect(state.franchises[0].purchases?.personalProgress ?? {}).toEqual({});
    const denied = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId: "expansion-1", amountMinor: 100_000 });
    expect(denied.ok).toBe(false);
    expect(denied.state.balanceMinor).toBe(state.balanceMinor);
    expect(denied.events).toEqual([]);
  });

  it("completes expansion through real harvest, stocking and feeding, including reload and server replay", () => {
    let state = createCampaignGame();
    state.balanceMinor = 1_000_000;
    const initial = structuredClone(state);
    const events: GameEvent[] = [];
    const act = (action: GameAction) => {
      const result = applyGameAction(state, action);
      expect(result.ok, result.message).toBe(true);
      expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
      state = result.state; events.push(...result.events);
    };
    const tick = (seconds: number) => {
      for (let second = 0; second < seconds; second++) {
        const result = advanceWorld(state, 1_000);
        state = result.state; events.push(...result.events);
      }
    };
    for (const purchaseId of ["cashier-1", "egg-display-1", "chicken-1"] as const) act({ type: "CONTRIBUTE_PURCHASE", purchaseId, amountMinor: 100_000 });
    tick(30);
    for (const quantity of [3, 3, 2]) {
      act({ type: "HARVEST", cropId: "crop-tomato-1", quantity });
      act({ type: "STOCK", productId: "tomatoes", quantity, source: "carry" });
    }
    for (const quantity of [3, 1]) {
      tick(30);
      act({ type: "HARVEST", cropId: "crop-tomato-1", quantity });
      act({ type: "OPERATE_MACHINE", machineId: "chicken-coop-1" });
      tick(6);
      act({ type: "OPERATE_MACHINE", machineId: "chicken-coop-1" });
      act({ type: "STOCK", productId: "eggs", quantity, source: "carry" });
      state = normalizeGameState(JSON.parse(JSON.stringify(state)));
    }
    act({ type: "CONTRIBUTE_PURCHASE", purchaseId: "farmer-1", amountMinor: 100_000 });
    const expansion = campaignPurchaseQuotes(state).find((quote) => quote.id === "expansion-1")!;
    expect(expansion.tasks.every((task) => task.completed)).toBe(true);
    expect(expansion.available).toBe(true);
    act({ type: "CONTRIBUTE_PURCHASE", purchaseId: "expansion-1", amountMinor: 100_000 });
    expect(validateSaveTransition(initial, state, events)).toEqual({ ok: true });
    expect(state.franchises[0].purchases!.personalProgress!["player:harvest:tomatoes"]).toBe(8);
    // A future progress event must not retroactively authorize an earlier purchase.
    const reordered = [...events.filter((event) => event.category === "purchase"), ...events.filter((event) => event.category !== "purchase")];
    expect(validateSaveTransition(initial, state, reordered).ok).toBe(false);
    const forged = structuredClone(state);
    forged.franchises[0].purchases!.personalProgress!["player:stock:milk"] = 4;
    expect(validateSaveTransition(initial, forged, events).ok).toBe(false);
  });

  it("starts all personal tasks empty and never grants progress for a failed interaction", () => {
    const state = createCampaignGame();
    for (const id of CAMPAIGN_TASK_IDS) expect(campaignTaskStatus(id).completed).toBe(false);
    const failed = applyGameAction(state, { type: "STOCK", productId: "tomatoes", quantity: 3, source: "carry" });
    expect(failed.ok).toBe(false);
    expect(failed.state).toEqual(state);
    expect(failed.events).toEqual([]);
  });
});
