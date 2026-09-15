import { describe, expect, it } from "vitest";
import { applyGameAction, createCampaignGame, normalizeGameState } from "../engine";
import { campaignLevel, campaignEmployeeLimit } from "./CampaignLevels";
import { OPENING_PURCHASES } from "./MartCampaign";
import { CAMPAIGN_TASK_IDS, campaignTaskTarget } from "./CampaignTasks";
import { campaignContracts } from "./CampaignContracts";
import { validateSaveTransition } from "../persistence/SaveAuthority";

describe("30 connected campaign levels", () => {
  it("advances on each purchase and requires personal mastery and deliveries for level 30", () => {
    let state = createCampaignGame();
    state.balanceMinor = 100_000_000;
    expect(state.franchises[0].carry.capacity).toBe(3);
    expect(OPENING_PURCHASES).toHaveLength(27);
    state.franchises[0].purchases!.personalProgress = Object.fromEntries(CAMPAIGN_TASK_IDS.map((id) => [id, campaignTaskTarget(id)]));
    for (const [index, purchase] of OPENING_PURCHASES.entries()) {
      const result = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId: purchase.id, amountMinor: state.balanceMinor });
      expect(result.ok, purchase.id).toBe(true);
      expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
      state = normalizeGameState(JSON.parse(JSON.stringify(result.state)));
      expect(state.level).toBe(index === 26 ? 29 : index + 2);
    }
    const incomplete = structuredClone(state.franchises[0]);
    incomplete.purchases!.personalProgress = {};
    expect(campaignLevel(incomplete)).toBe(28);
    for (const contract of campaignContracts(state.franchises[0])) {
      state.franchises[0].carry.items = Object.fromEntries(contract.products.map((product) => [product, 1]));
      const result = applyGameAction(state, { type: "DELIVER_CONTRACT", contractId: contract.id });
      expect(result.ok).toBe(true);
      expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
      state = result.state;
    }
    expect(state.level).toBe(30);
    const travelled = applyGameAction(applyGameAction(state, { type: "BUY_FRANCHISE", franchiseId: "estacion" }).state, { type: "TRAVEL", franchiseId: "estacion" });
    expect(travelled.ok).toBe(true);
    expect(travelled.state.level).toBe(30);
    expect(campaignLevel(travelled.state.franchises[1])).toBe(1);
  });

  it("caps hires including purchased staff and refuses forged levels", () => {
    let state = createCampaignGame();
    state.balanceMinor = 100_000_000;
    state.franchises[0].purchases!.purchased = ["cashier-1", "expansion-1"];
    expect(campaignEmployeeLimit(state.franchises[0], "cashier")).toBe(2);
    for (let index = 0; index < 2; index++) {
      const result = applyGameAction(state, { type: "HIRE", role: "cashier" });
      expect(result.ok).toBe(true);
      expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
      state = result.state;
    }
    expect(applyGameAction(state, { type: "HIRE", role: "cashier" }).ok).toBe(false);
    const forged = structuredClone(state);
    forged.level = 30;
    expect(validateSaveTransition(state, forged, []).ok).toBe(false);
  });
});
