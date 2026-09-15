import { describe, expect, it } from "vitest";
import { applyGameAction, createCampaignGame, normalizeGameState } from "../engine";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import { campaignExpansionQuote } from "./CampaignExpansion";
import { CAMPAIGN_TASK_IDS, CAMPAIGN_TASKS } from "./CampaignTasks";
import { OPENING_PURCHASES } from "./MartCampaign";
import { campaignContracts } from "./CampaignContracts";

function masteredOpening() {
  const state = createCampaignGame();
  state.balanceMinor = 100_000_000;
  state.franchises[0].purchases!.purchased = OPENING_PURCHASES.map((purchase) => purchase.id);
  state.franchises[0].purchases!.personalProgress = Object.fromEntries(CAMPAIGN_TASK_IDS.map((id) => [id, CAMPAIGN_TASKS[id].target]));
  state.franchises[0].purchases!.completedContracts = campaignContracts(state.franchises[0]).map((contract) => contract.id);
  return state;
}

describe("campaign locations", () => {
  it("prepares every locked location without inheritance or starting stock", () => {
    const state = normalizeGameState(createCampaignGame());
    for (const franchise of state.franchises) {
      expect(franchise.purchases).toEqual({ version: 1, inherited: [], purchased: [], contributions: {} });
      expect(franchise.employees).toEqual([]);
      expect(Object.values(franchise.shelves).every((quantity) => quantity === 0)).toBe(true);
      expect(franchise.crops[0].baseYield).toBe(8);
      expect(franchise.buildProjects).toEqual([]);
    }
  });
  it("does not open locations using money and legacy XP alone", () => {
    const state = createCampaignGame();
    state.balanceMinor = 100_000_000;
    state.level = 30;
    for (const target of state.franchises.slice(1)) {
      expect(applyGameAction(state, { type: "BUY_FRANCHISE", franchiseId: target.id }).ok).toBe(false);
    }
  });
  it.each(["player:stock:cheese", "player:stock:corn", "player:order:coffee", "player:stock:coffee", "player:stock:juice"] as const)("requires personal mastery of %s", (id) => {
    const state = masteredOpening();
    state.franchises[0].purchases!.personalProgress![id] = 0;
    expect(campaignExpansionQuote(state, "estacion").available).toBe(false);
    expect(applyGameAction(state, { type: "BUY_FRANCHISE", franchiseId: "estacion" }).ok).toBe(false);
  });
  it("opens once at level one, preserves both stores and cannot skip to the third", () => {
    const state = masteredOpening();
    const opened = applyGameAction(state, { type: "BUY_FRANCHISE", franchiseId: "estacion" });
    expect(opened.ok).toBe(true);
    expect(opened.state.level).toBe(30);
    expect(opened.state.balanceMinor).toBe(state.balanceMinor - state.franchises[1].purchaseCostMinor);
    expect(opened.state.franchises[0]).toEqual(state.franchises[0]);
    expect(opened.state.franchises[1].purchases!.purchased).toEqual([]);
    expect(validateSaveTransition(state, opened.state, opened.events)).toEqual({ ok: true });
    const restored = normalizeGameState(JSON.parse(JSON.stringify(opened.state)));
    expect(applyGameAction(restored, { type: "BUY_FRANCHISE", franchiseId: "estacion" }).ok).toBe(false);
    expect(applyGameAction(restored, { type: "BUY_FRANCHISE", franchiseId: "marina" }).ok).toBe(false);
    const travel = applyGameAction(restored, { type: "TRAVEL", franchiseId: "estacion" });
    expect(travel.ok).toBe(true);
    expect(travel.state.franchises[1].purchases!.personalProgress ?? {}).toEqual({});
    expect(validateSaveTransition(opened.state, travel.state, travel.events)).toEqual({ ok: true });
  });
  it("accepts last personal work and opening in one save, but rejects reversed event order", () => {
    const state = masteredOpening();
    const franchise = state.franchises[0];
    franchise.purchases!.personalProgress!["player:stock:coffee"] = 0;
    franchise.carry = { capacity: 4, items: { coffee: 4 } };
    franchise.unlockedAreas.push("pantry");
    const stocked = applyGameAction(state, { type: "STOCK", productId: "coffee", quantity: 4, source: "carry" });
    expect(stocked.ok).toBe(true);
    const opened = applyGameAction(stocked.state, { type: "BUY_FRANCHISE", franchiseId: "estacion" });
    expect(opened.ok).toBe(true);
    const events = [...stocked.events, ...opened.events];
    expect(validateSaveTransition(state, opened.state, events)).toEqual({ ok: true });
    const reversed = [...events].reverse().map((event, index) => ({ ...event, sequence: state.eventSequence + index + 1 }));
    expect(validateSaveTransition(state, opened.state, reversed).ok).toBe(false);
    expect(validateSaveTransition(state, opened.state, events.map((event) => event.category === "capital" ? { ...event, amountMinor: -1 } : event)).ok).toBe(false);
  });
  it("rejects ownership without an opening event even when the requirements are complete", () => {
    const state = masteredOpening();
    const forged = structuredClone(state);
    forged.franchises[1].owned = true;
    expect(validateSaveTransition(state, forged, []).ok).toBe(false);
  });
});
