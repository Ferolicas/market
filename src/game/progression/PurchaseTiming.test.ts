import { describe, expect, it } from "vitest";
import { applyGameAction, createCampaignGame } from "../engine";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import { PURCHASE_CONTRIBUTION_FILL_MS, PURCHASE_CONTRIBUTION_PULSE_MS, purchaseContributionPulseMinor, purchaseQuote } from "./PurchaseState";
import type { GameEvent } from "../types";

describe("purchase contribution timing", () => {
  it("pays a quarter of any price per second, so every marker fills in four seconds", () => {
    for (const cost of [2_000, 12_345, 1_800_000]) {
      const pulse = purchaseContributionPulseMinor(cost);
      const pulses = Math.ceil(cost / pulse);
      expect(pulses * PURCHASE_CONTRIBUTION_PULSE_MS).toBeLessThanOrEqual(PURCHASE_CONTRIBUTION_FILL_MS);
      expect(pulse * (1_000 / PURCHASE_CONTRIBUTION_PULSE_MS)).toBeGreaterThanOrEqual(cost / 4);
    }
    expect(purchaseContributionPulseMinor(0)).toBe(0);
  });

  it("completes the first purchase after twenty pulses and stops when the wallet runs dry", () => {
    const initial = createCampaignGame();
    initial.balanceMinor = 100_000;
    let state = initial;
    const events: GameEvent[] = [];
    const cost = purchaseQuote(state.franchises[0].purchases!, "farmer-1", state.countryCode).costMinor!;
    let pulses = 0;
    while (!state.franchises[0].purchases!.purchased.includes("farmer-1")) {
      const result = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId: "farmer-1" });
      expect(result.ok).toBe(true);
      events.push(...result.events);
      state = result.state;
      pulses += 1;
      expect(pulses).toBeLessThanOrEqual(20);
    }
    expect(pulses).toBe(20);
    expect(initial.balanceMinor - state.balanceMinor).toBe(cost);
    expect(validateSaveTransition(initial, state, events)).toEqual({ ok: true });

    const poor = createCampaignGame();
    poor.balanceMinor = Math.floor(purchaseContributionPulseMinor(cost) / 3);
    const partial = applyGameAction(poor, { type: "CONTRIBUTE_PURCHASE", purchaseId: "farmer-1" });
    expect(partial.ok).toBe(true);
    expect(partial.state.balanceMinor).toBe(0);
    expect(applyGameAction(partial.state, { type: "CONTRIBUTE_PURCHASE", purchaseId: "farmer-1" }).ok).toBe(false);
  });
});
