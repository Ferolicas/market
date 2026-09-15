import { describe, expect, it } from "vitest";
import { applyGameAction, createCampaignGame, normalizeGameState } from "../engine";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import { OPENING_PURCHASES } from "./MartCampaign";
import { MACHINE_BASE_COST_MINOR, ROSTER_BASE_COST_MINOR, ROSTER_UPGRADE_STEPS, rosterEntries, rosterStepCost } from "./RosterUpgrades";

function campaignWith(purchaseIds: readonly string[]) {
  const state = createCampaignGame();
  state.balanceMinor = 100_000_000;
  let current = state;
  for (const id of purchaseIds) {
    const purchase = OPENING_PURCHASES.find((candidate) => candidate.id === id)!;
    const result = applyGameAction(current, { type: "CONTRIBUTE_PURCHASE", purchaseId: purchase.id, amountMinor: 10_000_000 });
    expect(result.ok, purchase.id).toBe(true);
    current = result.state;
  }
  return normalizeGameState(JSON.parse(JSON.stringify(current)));
}

describe("roster upgrades", () => {
  it("prices four doubling steps, triple for machines", () => {
    expect(ROSTER_UPGRADE_STEPS).toBe(4);
    expect([0, 1, 2, 3].map((step) => rosterStepCost("player", step))).toEqual([8_000, 16_000, 32_000, 64_000]);
    expect([0, 1, 2, 3].map((step) => rosterStepCost("machine", step))).toEqual([24_000, 48_000, 96_000, 192_000]);
    expect(MACHINE_BASE_COST_MINOR).toBe(ROSTER_BASE_COST_MINOR * 3);
  });

  it("lists the player, the staff, the animals, the machines and the beds", () => {
    const state = campaignWith(["farmer-1", "egg-display-1", "chicken-1"]);
    const entries = rosterEntries(state.franchises[0], 1);
    expect(entries.map((entry) => entry.kind)).toContain("player");
    expect(entries.filter((entry) => entry.kind === "employee")).toHaveLength(1);
    expect(entries.filter((entry) => entry.kind === "animal")).toHaveLength(1);
    expect(entries.filter((entry) => entry.kind === "crop").length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.stepCostsMinor.length === 4)).toBe(true);
  });

  it("raises speed and capacity one paid step at a time, and never a fifth", () => {
    let state = campaignWith(["farmer-1"]);
    state.balanceMinor = 1_000_000;
    for (let step = 1; step <= ROSTER_UPGRADE_STEPS; step++) {
      const before = state.balanceMinor;
      const result = applyGameAction(state, { type: "UPGRADE_ROSTER", entryId: "player" });
      expect(result.ok, `step ${step}`).toBe(true);
      expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
      state = result.state;
      expect(before - state.balanceMinor).toBe(8_000 * 2 ** (step - 1));
      expect(state.franchises[0].carry.capacity).toBe(3 + step);
      expect(state.franchises[0].playerSpeedTier).toBe(1 + step);
    }
    expect(applyGameAction(state, { type: "UPGRADE_ROSTER", entryId: "player" }).ok).toBe(false);
    const restored = normalizeGameState(JSON.parse(JSON.stringify(state)));
    expect(rosterEntries(restored.franchises[0], 1)[0]).toMatchObject({ step: 4, nextCostMinor: null });
  });

  it("stacks on the tier a purchase already paid for, without charging staff twice", () => {
    let state = campaignWith(["farmer-1", "egg-display-1", "chicken-1", "player-2", "tomato-2", "farmer-2"]);
    state.balanceMinor = 1_000_000;
    // player-2 already granted capacity 4 and speed tier 2.
    expect(rosterEntries(state.franchises[0], 1)[0]).toMatchObject({ step: 0 });
    const upgraded = applyGameAction(state, { type: "UPGRADE_ROSTER", entryId: "player" });
    expect(upgraded.ok).toBe(true);
    state = upgraded.state;
    expect(state.franchises[0].carry.capacity).toBe(5);
    expect(state.franchises[0].playerSpeedTier).toBe(3);
    const trainee = rosterEntries(state.franchises[0], 1).find((entry) => entry.kind === "employee")!;
    const trained = applyGameAction(state, { type: "UPGRADE_ROSTER", entryId: trainee.id });
    expect(trained.ok).toBe(true);
    expect(trained.state.franchises[0].employees.filter((employee) => employee.role === "farmer")).toHaveLength(2);
    expect(trained.state.franchises[0].employees[0].level).toBe(2);
  });

  it("refuses an unknown entry and an upgrade with no money", () => {
    const state = campaignWith(["farmer-1"]);
    state.balanceMinor = 10;
    expect(applyGameAction(state, { type: "UPGRADE_ROSTER", entryId: "employee:ghost" }).ok).toBe(false);
    expect(applyGameAction(state, { type: "UPGRADE_ROSTER", entryId: "player" }).ok).toBe(false);
  });
});
