import { describe, expect, it } from "vitest";
import { applyGameAction, createCampaignGame, normalizeGameState } from "../engine";
import { validateSaveTransition } from "./SaveAuthority";
import { savePayloadSchema } from "../../lib/game-validation";
import { campaignLevel } from "../progression/CampaignLevels";

/** A save written before the campaign was reordered: it had bought the
 * cashier, which is no longer a purchase, and hired them at level three. */
function legacySave() {
  const state = createCampaignGame();
  state.tutorialStep = 1;
  state.balanceMinor = 50_000;
  const franchise = state.franchises[0];
  franchise.purchases!.purchased = ["cashier-1", "egg-display-1", "chicken-1"] as never;
  franchise.purchases!.contributions = { "cashier-1": 6_800, "egg-display-1": 6_800, "chicken-1": 10_200 } as never;
  franchise.employees = [{
    id: "legacy-cashier", name: "Luna", role: "cashier", level: 1, salaryMinor: 3_400, energy: 100, hat: "red-panda",
  }] as never;
  return state;
}

describe("campaign migration", () => {
  it("drops retired purchases and desks so the save keeps working", () => {
    const restored = normalizeGameState(JSON.parse(JSON.stringify(legacySave())));
    const franchise = restored.franchises[0];
    expect(franchise.purchases!.purchased).toEqual(["egg-display-1", "chicken-1"]);
    expect(franchise.purchases!.contributions).toEqual({ "egg-display-1": 6_800, "chicken-1": 10_200 });
    expect(franchise.employees.filter((employee) => employee.role === "cashier")).toHaveLength(0);
    expect(campaignLevel(franchise)).toBe(3);
  });

  it("produces a state the schema and the server both accept", () => {
    const restored = normalizeGameState(JSON.parse(JSON.stringify(legacySave())));
    const result = applyGameAction(restored, { type: "TOGGLE_STORE" });
    expect(result.ok).toBe(true);
    expect(validateSaveTransition(restored, result.state, result.events)).toEqual({ ok: true });
    const payload = {
      state: result.state,
      events: result.events,
      expectedRevision: 1,
      operationId: "00000000-0000-4000-8000-000000000000",
      sessionId: "00000000-0000-4000-8000-000000000001",
      deviceId: "00000000-0000-4000-8000-000000000002",
    };
    expect(savePayloadSchema.safeParse(payload).success).toBe(true);
  });
});
