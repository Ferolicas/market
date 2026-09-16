import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, createCampaignGame, normalizeGameState } from "../engine";
import { validateSaveTransition } from "./SaveAuthority";
import { savePayloadSchema } from "../../lib/game-validation";
import { campaignEmployeeLimit, campaignLevel } from "../progression/CampaignLevels";
import { OPENING_PURCHASES } from "../progression/MartCampaign";

/** A save written before the campaign was reordered: it had bought the
 * cashier, which is no longer a purchase, and its level counted that buy. */
function legacySave(knownPurchases: number) {
  const state = createCampaignGame();
  state.tutorialStep = 1;
  state.balanceMinor = 50_000;
  state.level = knownPurchases + 2;
  state.progression.completedLevels = Array.from({ length: knownPurchases + 1 }, (_, index) => index + 1);
  const franchise = state.franchises[0];
  franchise.purchases!.purchased = ["cashier-1", ...OPENING_PURCHASES.slice(0, knownPurchases).map((purchase) => purchase.id)] as never;
  franchise.purchases!.contributions = { "cashier-1": 6_800, "egg-display-1": 6_800, "chicken-1": 10_200 } as never;
  franchise.employees = [{
    id: "legacy-cashier", name: "Luna", role: "cashier", level: 1, salaryMinor: 3_400, energy: 100, hat: "red-panda",
  }] as never;
  return state;
}

const restore = (state: unknown) => normalizeGameState(JSON.parse(JSON.stringify(state)));

describe("campaign migration", () => {
  it("drops the retired purchase and keeps the cashier once level 5 grants the desk", () => {
    const restored = restore(legacySave(6));
    const franchise = restored.franchises[0];
    expect(franchise.purchases!.purchased).toEqual(OPENING_PURCHASES.slice(0, 6).map((purchase) => purchase.id));
    expect(franchise.purchases!.contributions).toEqual({ "egg-display-1": 6_800, "chicken-1": 10_200 });
    expect(campaignLevel(franchise)).toBe(7);
    expect(campaignEmployeeLimit(franchise, "cashier")).toBe(1);
    expect(franchise.employees.filter((employee) => employee.role === "cashier").map((employee) => employee.id)).toEqual(["legacy-cashier"]);
  });

  it("retires a cashier hired below level 5 and re-derives the level ladder on load", () => {
    const restored = restore(legacySave(2));
    expect(campaignLevel(restored.franchises[0])).toBe(3);
    expect(restored.franchises[0].employees.filter((employee) => employee.role === "cashier")).toHaveLength(0);
    expect(restored.level).toBe(3);
    expect(restored.progression.completedLevels).toEqual([1, 2]);
  });

  it("keeps progress monotonic through the first ticks so the server accepts the save", () => {
    for (const restored of [restore(legacySave(2)), restore(legacySave(6))]) {
      let ticked = restored;
      for (let index = 0; index < 8; index += 1) ticked = advanceWorld(ticked, 250).state;
      expect(ticked.progression.completedLevels).toEqual(restored.progression.completedLevels);
      expect(validateSaveTransition(restored, ticked, [])).toEqual({ ok: true });
    }
  });

  it("trims baskets from the older shopper generator down to what the schema accepts", () => {
    const state = legacySave(6);
    state.franchises[0].customers.push({
      id: "big-basket", identity: 2, state: "NAVIGATE_TO_PRODUCT", shoppingList: [{ productId: "tomatoes", requested: 4, picked: 4 }, { productId: "eggs", requested: 2, picked: 0 }], currentLine: 1,
      basket: { tomatoes: 4 }, patienceMs: 120_000, checkoutPatienceMs: 120_000, waitingSince: null, queueSlot: null, transactionId: null, hasCart: true, hasBag: false, angry: false,
      x: 0, z: 0, targetX: 0, targetZ: 0, path: [], pathIndex: 0, speed: 1.4, stateSince: 0, reservedSocketId: null, blockedSince: null, routeFailures: 0, queueLane: 0,
    });
    const restored = restore(state);
    expect(restored.franchises[0].customers[0].shoppingList[0]).toEqual({ productId: "tomatoes", requested: 3, picked: 3 });
    const payload = {
      state: { ...restored, lastSavedAt: new Date().toISOString() }, events: [], expectedRevision: 1,
      operationId: "00000000-0000-4000-8000-000000000000", sessionId: "00000000-0000-4000-8000-000000000001", deviceId: "00000000-0000-4000-8000-000000000002",
    };
    expect(savePayloadSchema.safeParse(JSON.parse(JSON.stringify(payload))).success).toBe(true);
    let ticked = restored;
    for (let index = 0; index < 8; index += 1) ticked = advanceWorld(ticked, 250).state;
    expect(validateSaveTransition(restored, ticked, [])).toEqual({ ok: true });
  });

  it("produces a state the schema and the server both accept", () => {
    const restored = restore(legacySave(6));
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
