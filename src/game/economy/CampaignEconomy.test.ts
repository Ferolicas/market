import { describe, expect, it } from "vitest";
import { applyGameAction, createCampaignGame, createInitialGame, normalizeGameState } from "../engine";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import { COUNTRIES } from "../catalog";
import type { CountryCode } from "../types";

describe("campaign economy", () => {
  it.each(Object.keys(COUNTRIES) as CountryCode[])("starts without capital or daily bonuses in %s", (country) => {
    const state = createCampaignGame(country);
    expect(state.balanceMinor).toBe(0);
    expect(state.missions).toEqual([]);
    state.missions = createInitialGame(country).missions.map((mission) => ({ ...mission, completed: true }));
    const claim = applyGameAction(state, { type: "CLAIM_MISSION", missionId: state.missions[0].id });
    expect(claim.ok).toBe(false);
    expect(claim.events).toEqual([]);
    expect(normalizeGameState(JSON.parse(JSON.stringify(state))).missions).toEqual([]);
  });

  it("keeps register cash, personal work and license through eight empty daily closures and reloads", () => {
    let state = createCampaignGame();
    state.balanceMinor = 6_800;
    state = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId: "cashier-1", amountMinor: 6_800 }).state;
    expect(state.franchises[0].employees).toHaveLength(1);
    state.balanceMinor = 0;
    state.franchises[0].registerCashMinor = [100, 200];
    state.franchises[0].purchases!.personalProgress = { "player:stock:tomatoes": 3 };
    for (let day = 1; day <= 8; day++) {
      state.franchises[0].open = true;
      // Revenue in a drawer must never trigger a debit from an empty wallet.
      state.franchises[0].revenueTodayMinor = 30_000;
      const result = applyGameAction(state, { type: "CLOSE_DAY" });
      expect(result.ok).toBe(true);
      expect(result.state.day).toBe(day + 1);
      expect(result.state.balanceMinor).toBe(0);
      expect(result.state.franchises[0].registerCashMinor).toEqual([100, 200]);
      expect(result.events.filter((event) => ["payroll", "operations", "tax"].includes(event.category))).toEqual([]);
      expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
      state = normalizeGameState(JSON.parse(JSON.stringify(result.state)));
      expect(state.franchises[0].purchases!.personalProgress).toEqual({ "player:stock:tomatoes": 3 });
      expect(state.missions).toEqual([]);
      expect(applyGameAction(state, { type: "CLOSE_DAY" }).ok).toBe(false);
    }
    expect(applyGameAction(state, { type: "TOGGLE_STORE" }).ok).toBe(true);
    expect(applyGameAction(state, { type: "BUY_LICENSE" }).ok).toBe(false);
    expect(state.finances.payrollMinor).toBe(0);
    expect(state.finances.operatingCostsMinor).toBe(0);
    expect(state.finances.taxesMinor).toBe(0);
  });

  it("rejects a forged legacy reward event in a campaign save", () => {
    const legacy = createInitialGame();
    legacy.missions[0].completed = true;
    const claimed = applyGameAction(legacy, { type: "CLAIM_MISSION", missionId: legacy.missions[0].id });
    expect(claimed.ok).toBe(true);
    expect(validateSaveTransition(legacy, claimed.state, claimed.events)).toEqual({ ok: true });
    const purchases = createCampaignGame().franchises[0].purchases;
    legacy.franchises[0].purchases = purchases;
    claimed.state.franchises[0].purchases = purchases;
    expect(validateSaveTransition(legacy, claimed.state, claimed.events).ok).toBe(false);
  });

  it("preserves legacy daily costs and license countdown", () => {
    const state = createInitialGame();
    state.franchises[0].open = true;
    const result = applyGameAction(state, { type: "CLOSE_DAY" });
    expect(result.ok).toBe(true);
    expect(result.state.balanceMinor).toBe(state.balanceMinor - 2_600);
    expect(result.state.franchises[0].licenseDaysLeft).toBe(6);
    expect(result.state.missions).toHaveLength(3);
    expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
  });
});
