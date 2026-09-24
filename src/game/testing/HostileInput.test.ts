import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, createCampaignGame, normalizeGameState } from "../engine";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import { gameCommandSchema, savePayloadSchema } from "../../lib/game-validation";
import { replayCommands, type GameCommand } from "../persistence/CommandLog";
import { runCampaignBot } from "./CampaignBot";
import type { GameAction, GameState, WorldInteractionAction } from "../types";
import { COUNTRIES } from "../catalog";

/**
 * The client is untrusted and can send any action at any time (§0.3 of the
 * design system): spam, cancelled mid-action, boundary values, two inputs at
 * once. Every path here must leave the state valid and the money conserved.
 */
function wealth(state: GameState) {
  return state.balanceMinor + state.franchises.reduce((sum, franchise) => sum + franchise.registerCashMinor.reduce((lanes, lane) => lanes + lane, 0), 0);
}

function playedState() {
  const run = runCampaignBot(normalizeGameState(createCampaignGame("ES")), { targetLevel: 6, maxTicks: 1_200 });
  expect(run.level).toBeGreaterThanOrEqual(6);
  const state = run.state;
  state.franchises[0].open = true;
  return state;
}

function invariants(state: GameState) {
  expect(Number.isSafeInteger(state.balanceMinor) && state.balanceMinor >= 0).toBe(true);
  for (const franchise of state.franchises) {
    for (const quantity of [...Object.values(franchise.warehouse), ...Object.values(franchise.shelves), ...Object.values(franchise.carry.items)]) {
      expect(Number.isSafeInteger(quantity) && (quantity as number) >= 0).toBe(true);
    }
    expect(Object.values(franchise.carry.items).reduce((sum, quantity) => sum + (quantity ?? 0), 0)).toBeLessThanOrEqual(franchise.carry.capacity);
    for (const lane of franchise.registerCashMinor) expect(Number.isSafeInteger(lane) && lane >= 0).toBe(true);
  }
  expect(savePayloadSchema.safeParse({ expectedRevision: 1, operationId: "00000000-0000-4000-8000-000000000000", deviceId: "00000000-0000-4000-8000-000000000001", sessionId: "00000000-0000-4000-8000-000000000002", state: JSON.parse(JSON.stringify(state)), events: [] }).success).toBe(true);
}

describe("hostile input", () => {
  it("spamming the same interaction a thousand times in one tick does no more than the basket allows", () => {
    const state = playedState();
    const crop = state.franchises[0].crops.find((candidate) => candidate.status === "READY") ?? state.franchises[0].crops[0];
    Object.assign(crop, { status: "READY", available: 8, readyAt: 0 });
    const before = wealth(state);
    const walkedBefore = state.progression.counters["distance:player"] ?? 0;
    const spam: WorldInteractionAction[] = Array.from({ length: 1_000 }, () => ({ type: "HARVEST", cropId: crop.id, productId: crop.productId, quantity: 999 }));
    const result = advanceWorld(state, 200, undefined, { interactions: spam, playerDistanceMeters: 1e9 });
    const franchise = result.state.franchises[0];
    expect(Object.values(franchise.carry.items).reduce((sum, quantity) => sum + (quantity ?? 0), 0)).toBeLessThanOrEqual(franchise.carry.capacity);
    expect(wealth(result.state)).toBe(before);
    // Distance is clamped per tick: a forged kilometre counts as 100 m.
    expect((result.state.progression.counters["distance:player"] ?? 0) - walkedBefore).toBeLessThanOrEqual(100);
    invariants(result.state);
  });

  it("refuses boundary and garbage values without touching money or stock", () => {
    const state = playedState();
    const before = { wealth: wealth(state), json: JSON.stringify(state) };
    const garbage: GameAction[] = [
      { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: -5 },
      { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: Number.NaN },
      { type: "ORDER", supplierId: "nope", productId: "wheat", quantity: 1 },
      { type: "COLLECT_REGISTER", lane: 7 as 0 },
      { type: "COLLECT_REGISTER", lane: -1 as 0 },
      { type: "CONTRIBUTE_PURCHASE", purchaseId: "corn-canner-1", amountMinor: 1e15 },
      { type: "CONTRIBUTE_PURCHASE", purchaseId: "farmer-1", amountMinor: -100 },
      { type: "CONTRIBUTE_PURCHASE", purchaseId: "nope" as "farmer-1", amountMinor: 1 },
      { type: "OPERATE_MACHINE", machineId: "does-not-exist" },
      { type: "HIRE", role: "manager" },
      { type: "TRAVEL", franchiseId: "megastore" },
      { type: "BUY_FRANCHISE", franchiseId: "megastore" },
      { type: "DELIVER_CONTRACT", contractId: "mega-campo" },
      { type: "STOCK", productId: "cannedCorn", quantity: 5 },
      { type: "PICKUP_WAREHOUSE", productId: "juice", quantity: 1e9 },
      { type: "CHECKOUT", paymentMethod: "cash" },
      { type: "UPGRADE", upgrade: "expansion" },
      { type: "CONTRIBUTE_BUILD", amountMinor: 1_000 },
      { type: "CLAIM_MISSION", missionId: "none" },
      { type: "SET_COUNTRY", countryCode: "US" },
    ];
    for (const action of garbage) {
      const result = applyGameAction(state, action);
      expect(result.ok, action.type).toBe(false);
      expect(result.state, action.type).toBe(state);
    }
    expect(wealth(state)).toBe(before.wealth);
    expect(JSON.stringify(state)).toBe(before.json);
  });

  it("keeps money conserved when the same purchase is paid from two inputs in the same tick", () => {
    const state = playedState();
    state.balanceMinor = 10_000;
    const purchase = { type: "CONTRIBUTE_PURCHASE", purchaseId: "farmer-2", amountMinor: 9_000 } as const;
    const quote = applyGameAction(state, purchase);
    const twice = advanceWorld(state, 200, undefined, { interactions: [purchase, purchase, purchase] });
    const spent = state.balanceMinor - twice.state.balanceMinor;
    // At most the price once; never twice, never negative.
    expect(spent).toBeGreaterThanOrEqual(0);
    expect(spent).toBeLessThanOrEqual(quote.ok ? 9_000 : 0);
    invariants(twice.state);
    expect(validateSaveTransition(state, twice.state, twice.events).ok).toBe(true);
  });

  it("cannot leave a checkout half done: abandoning the till stops sales but keeps the till honest", () => {
    let state = playedState();
    const franchise = state.franchises[0];
    franchise.shelves.tomatoes = 30;
    franchise.employees = franchise.employees.filter((employee) => employee.role !== "cashier");
    for (let tick = 0; tick < 400 && !state.franchises[0].checkoutTransactions.some((transaction) => transaction.state === "SCANNING" || transaction.state === "CUSTOMER_LOADING"); tick += 1) {
      state = advanceWorld(state, 1_000).state;
    }
    const before = wealth(state);
    const registerBefore = [...state.franchises[0].registerCashMinor];
    // One scan, then the owner walks away for a long time.
    state = advanceWorld(state, 1_000, undefined, { interactions: [{ type: "CHECKOUT", paymentMethod: "cash" }] }).state;
    for (let tick = 0; tick < 300; tick += 1) state = advanceWorld(state, 1_000).state;
    const after = state.franchises[0];
    expect(after.checkoutTransactions.every((transaction) => ["CUSTOMER_LOADING", "SCANNING", "BAGGING", "PAYMENT", "COMPLETE", "ABANDONED"].includes(transaction.state))).toBe(true);
    // Whatever was sold is in a till, never conjured into the wallet.
    expect(state.balanceMinor).toBe(before - registerBefore.reduce((sum, lane) => sum + lane, 0) + registerBefore.reduce((sum, lane) => sum + lane, 0));
    invariants(state);
  });

  it("rejects malformed command streams at the schema and tolerates rejected actions in a valid one", () => {
    expect(gameCommandSchema.safeParse({ k: "t", d: -1, n: 1 }).success).toBe(false);
    expect(gameCommandSchema.safeParse({ k: "t", d: 5_000, n: 1 }).success).toBe(false);
    expect(gameCommandSchema.safeParse({ k: "t", d: 200, n: 2 }).success).toBe(false);
    expect(gameCommandSchema.safeParse({ k: "t", d: 200, n: 1, i: Array.from({ length: 65 }, () => ({ type: "HARVEST" })) }).success).toBe(false);
    expect(gameCommandSchema.safeParse({ k: "s", m: 0 }).success).toBe(false);
    expect(gameCommandSchema.safeParse({ k: "x" }).success).toBe(false);
    expect(gameCommandSchema.safeParse({ k: "a", a: { type: "HARVEST", cropId: "crop-tomato-1" } }).success).toBe(true);
    const base = normalizeGameState(createCampaignGame("ES"));
    const commands: GameCommand[] = [
      { k: "a", a: { type: "HIRE", role: "manager" } },
      { k: "a", a: { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 1e12 } },
      { k: "t", d: 200, n: 0, i: [{ type: "COLLECT_REGISTER", lane: 0 }, { type: "CHECKOUT", paymentMethod: "card" }] },
    ];
    const replayed = replayCommands(base, commands);
    expect(replayed.applied).toBe(1);
    expect(replayed.state.balanceMinor).toBe(base.balanceMinor);
    invariants(replayed.state);
  });

  it("locks the fiscal country once anything was bought", () => {
    const state = playedState();
    expect(applyGameAction(state, { type: "SET_COUNTRY", countryCode: "CO" }).ok).toBe(false);
    expect(state.currency).toBe(COUNTRIES[state.countryCode].currency);
  });
});
