import { describe, expect, it } from "vitest";
import { applyGameAction, createCampaignGame, createInitialGame, normalizeGameState } from "../engine";
import { CAMPAIGN_CONTRACTS, campaignContracts } from "./CampaignContracts";
import { OPENING_PURCHASES } from "./MartCampaign";
import { CAMPAIGN_TASK_IDS, campaignTaskTarget } from "./CampaignTasks";
import { campaignExpansionQuote } from "./CampaignExpansion";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import type { GameAction, GameEvent } from "../types";
import { PRODUCT_IDS } from "../economy/ProductRegistry";

function prepared() {
  const state = createCampaignGame();
  state.balanceMinor = 100_000_000;
  for (const franchise of state.franchises) {
    franchise.purchases!.purchased = OPENING_PURCHASES.map((item) => item.id);
    franchise.purchases!.personalProgress = Object.fromEntries(CAMPAIGN_TASK_IDS.map((id) => [id, campaignTaskTarget(id, franchise.id)]));
  }
  return state;
}

describe("composed personal orders", () => {
  it("defines eighteen sequential, three-unit orders covering the full catalog", () => {
    expect(new Set(CAMPAIGN_CONTRACTS.map((contract) => contract.id)).size).toBe(18);
    expect(new Set(CAMPAIGN_CONTRACTS.flatMap((contract) => [...contract.products])).size).toBe(PRODUCT_IDS.length);
    for (const contract of CAMPAIGN_CONTRACTS) {
      expect(contract.products).toHaveLength(3);
      expect(new Set(contract.products).size).toBe(3);
    }
  });
  it("does not use warehouse stock, accept partial baskets, foreign IDs or legacy saves", () => {
    const state = prepared();
    const contract = campaignContracts(state.franchises[0])[0];
    for (const product of contract.products) state.franchises[0].warehouse[product] = 10;
    state.franchises[0].carry.items = { tomatoes: 1, eggs: 1 };
    for (const id of [contract.id, "estacion-desayuno", "unknown", "barrio-molienda"]) {
      const result = applyGameAction(state, { type: "DELIVER_CONTRACT", contractId: id });
      expect(result.ok).toBe(false);
      expect(result.state).toBe(state);
      expect(result.events).toEqual([]);
    }
    expect(applyGameAction(createInitialGame(), { type: "DELIVER_CONTRACT", contractId: contract.id }).ok).toBe(false);
    expect(applyGameAction(createCampaignGame(), { type: "DELIVER_CONTRACT", contractId: contract.id }).ok).toBe(false);
  });
  it("delivers all eighteen orders from personal carry once, with save/reload and no monetary bonuses", () => {
    let state = prepared();
    for (const location of state.franchises.map((item) => item.id)) {
      state.currentFranchiseId = location;
      state.franchises.find((item) => item.id === location)!.owned = true;
      for (const contract of campaignContracts(state.franchises.find((item) => item.id === location)!)) {
        for (const product of contract.products) state.franchises.find((item) => item.id === location)!.warehouse[product] = 1;
        const initial = structuredClone(state);
        const events: GameEvent[] = [];
        for (const action of [...contract.products.map((productId): GameAction => ({ type: "PICKUP_WAREHOUSE", productId, quantity: 1 })), { type: "DELIVER_CONTRACT", contractId: contract.id } as GameAction]) {
          const result = applyGameAction(state, action);
          expect(result.ok, result.message).toBe(true);
          expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
          state = result.state;
          events.push(...result.events);
        }
        expect(validateSaveTransition(initial, state, events)).toEqual({ ok: true });
        expect(state.balanceMinor).toBe(initial.balanceMinor);
        const local = state.franchises.find((item) => item.id === location)!;
        expect(Object.values(local.carry.items).reduce((sum, quantity) => sum + (quantity ?? 0), 0)).toBe(0);
        expect(contract.products.every((product) => local.warehouse[product] === 0)).toBe(true);
        state = normalizeGameState(JSON.parse(JSON.stringify(state)));
        expect(applyGameAction(state, { type: "DELIVER_CONTRACT", contractId: contract.id }).ok).toBe(false);
      }
    }
  });
  it("requires orders for expansion and rejects forged completion and tampered recipe events", () => {
    let state = prepared();
    expect(campaignExpansionQuote(state, "estacion").available).toBe(false);
    const forged = structuredClone(state);
    forged.franchises[0].purchases!.completedContracts = campaignContracts(forged.franchises[0]).map((contract) => contract.id);
    expect(validateSaveTransition(state, forged, []).ok).toBe(false);
    const events: GameEvent[] = [];
    let lastBefore = state;
    for (const contract of campaignContracts(state.franchises[0])) {
      state.franchises[0].carry.items = Object.fromEntries(contract.products.map((product) => [product, 1]));
      lastBefore = structuredClone(state);
      const result = applyGameAction(state, { type: "DELIVER_CONTRACT", contractId: contract.id });
      expect(result.ok).toBe(true);
      expect(validateSaveTransition(state, result.state, result.events.map((event) => ({ ...event, payload: { ...event.payload, products: ["tomatoes"] } }))).ok).toBe(false);
      state = result.state;
      events.splice(0, events.length, ...result.events);
    }
    const opened = applyGameAction(state, { type: "BUY_FRANCHISE", franchiseId: "estacion" });
    expect(opened.ok).toBe(true);
    const batch = [...events, ...opened.events];
    expect(validateSaveTransition(lastBefore, opened.state, batch)).toEqual({ ok: true });
    const reversed = [...batch].reverse().map((event, index) => ({ ...event, sequence: lastBefore.eventSequence + index + 1 }));
    expect(validateSaveTransition(lastBefore, opened.state, reversed).ok).toBe(false);
  });
});
