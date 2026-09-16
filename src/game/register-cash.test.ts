import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, createInitialGame, normalizeGameState } from "./engine";
import { createCustomerMind } from "./ai/CustomerBrain";
import { validateSaveTransition } from "./persistence/SaveAuthority";
import { isPreRegisterSnapshot, preRegisterChecksumState } from "./persistence/RegisterCompatibility";
import { savePayloadSchema } from "../lib/game-validation";
import type { CustomerRuntimeState, GameEvent, GameState, ProductId } from "./types";
import { REGISTER_INTERACTION_IDS, registerLane, registerPickupPosition } from "./stations/register-layout";
import { CHECKOUT_LANES } from "./stations/checkout-layout";
import { createPurchaseState } from "./progression/PurchaseState";
import { campaignLevel, campaignPriceMultiplier } from "./progression/CampaignLevels";
import { storeSegmentIsClear } from "./world-scale";

function readyPayment(lane: 0 | 1 = 0, productId: ProductId = "tomatoes") {
  const state = createInitialGame();
  const franchise = state.franchises[0];
  franchise.unlockedAreas.push("checkout-2");
  const customer: CustomerRuntimeState = {
    ...createCustomerMind("cash-test", [productId], 1, 1), identity: 1,
    state: "PAY", queueLane: lane, queueSlot: 0, queueJoinedAt: 0, basket: { [productId]: 1 }, transactionId: "cash-test-tx", stateSince: 0,
    shoppingList: [{ productId, requested: 1, picked: 1 }],
    checkoutPatienceMs: 300_000, hasCart: true, hasBag: false, angry: false,
    x: 7, z: 2.85, targetX: 7, targetZ: 2.85, path: [], pathIndex: 0, speed: 1.4,
    reservedSocketId: null, blockedSince: null, routeFailures: 0,
  };
  franchise.customers = [customer];
  franchise.checkoutTransactions = [{
    id: "cash-test-tx", customerId: customer.id, pendingItems: [{ productId, quantity: 1, loaded: 1, scanned: 1, bagged: 1 }],
    paymentMethod: "cash", state: "PAYMENT", nextUnitIndex: 1, paymentCommitted: false,
    updatedAt: 0, lastLoadedAt: 0, lastScannedAt: 0, lastBaggedAt: 0, checkoutLane: lane,
  }];
  state.simulationTimeMs = 1_000;
  return state;
}

function payload(state: GameState, events: GameEvent[] = []) {
  return { expectedRevision: 1, operationId: "22222222-2222-4222-8222-222222222222", deviceId: "33333333-3333-4333-8333-333333333333", sessionId: "11111111-1111-4111-8111-111111111111", state, events };
}

describe("physical cash collection", () => {
  it("sells preserves at the level price over 360 base units and cannot collect their payment twice after reload", () => {
    const initial = readyPayment(0, "cannedCorn");
    initial.franchises[0].purchases = createPurchaseState();
    initial.franchises[0].purchases.purchased.push("preserves-supply-1");
    // One purchase makes this a level-2 store: 3,60 € × 1,03 = 3,71 €.
    const price = Math.round(360 * campaignPriceMultiplier(campaignLevel(initial.franchises[0])));
    expect(price).toBe(371);
    const sale = advanceWorld(initial, 1_000);
    expect(sale.state.franchises[0].registerCashMinor[0]).toBe(price);
    expect(sale.state.finances.grossRevenueMinor).toBe(price);
    expect(sale.state.balanceMinor).toBe(initial.balanceMinor);
    expect(validateSaveTransition(initial, sale.state, sale.events)).toEqual({ ok: true });
    const collected = applyGameAction(normalizeGameState(JSON.parse(JSON.stringify(sale.state))), { type: "COLLECT_REGISTER", lane: 0 });
    expect(collected.ok).toBe(true);
    expect(collected.state.balanceMinor).toBe(initial.balanceMinor + price);
    expect(validateSaveTransition(sale.state, collected.state, collected.events)).toEqual({ ok: true });
    expect(applyGameAction(collected.state, { type: "COLLECT_REGISTER", lane: 0 }).ok).toBe(false);
  });
  it("charges exactly one euro per opening tomato without fiscal deductions in the campaign", () => {
    const initial = readyPayment();
    initial.franchises[0].purchases = createPurchaseState();
    const sale = advanceWorld(initial, 1_000);
    expect(sale.state.franchises[0].registerCashMinor[0]).toBe(100);
    expect(sale.state.finances.grossRevenueMinor).toBe(100);
    expect(sale.state.balanceMinor).toBe(initial.balanceMinor);
    expect(validateSaveTransition(initial, sale.state, sale.events)).toEqual({ ok: true });
  });
  it("places both pickup points outside furniture and away from the cashier", () => {
    for (const id of REGISTER_INTERACTION_IDS) {
      const lane = registerLane(id);
      const [x, , z] = registerPickupPosition(lane);
      expect(storeSegmentIsClear([x, z], [x, z])).toBe(true);
      expect(Math.hypot(x - CHECKOUT_LANES[lane].cashierWork[0], z - CHECKOUT_LANES[lane].cashierWork[2])).toBeGreaterThan(1);
    }
  });
  it.each([0, 1] as const)("holds the sale in lane %s and collects it once", (lane) => {
    const initial = readyPayment(lane);
    const sale = advanceWorld(initial, 1_000);
    const sold = sale.events.find((event) => event.category === "sales")!;
    expect(sold).toBeDefined();
    expect(sold.payload?.lane).toBe(lane);
    expect(sale.state.balanceMinor).toBe(initial.balanceMinor);
    expect(sale.state.franchises[0].registerCashMinor[lane]).toBe(sold.amountMinor);
    expect(validateSaveTransition(initial, sale.state, sale.events)).toEqual({ ok: true });
    const restored = normalizeGameState(JSON.parse(JSON.stringify(sale.state)));
    const collected = applyGameAction(restored, { type: "COLLECT_REGISTER", lane });
    expect(collected.ok).toBe(true);
    expect(collected.state.balanceMinor).toBe(initial.balanceMinor + sold.amountMinor);
    expect(collected.state.franchises[0].registerCashMinor).toEqual([0, 0]);
    expect(collected.state.finances).toEqual(restored.finances);
    expect(collected.events[0]).toMatchObject({ category: "cash_collection", amountMinor: 0, payload: { lane, collectedMinor: sold.amountMinor } });
    expect(validateSaveTransition(sale.state, collected.state, collected.events)).toEqual({ ok: true });
    expect(validateSaveTransition(initial, collected.state, [...sale.events, ...collected.events])).toEqual({ ok: true });
    const duplicate = applyGameAction(collected.state, { type: "COLLECT_REGISTER", lane });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.events).toEqual([]);
    expect(duplicate.state).toBe(collected.state);
  });

  it("does not let a duplicate payment replenish a collected register", () => {
    const sale = advanceWorld(readyPayment(), 1_000);
    const collected = applyGameAction(sale.state, { type: "COLLECT_REGISTER", lane: 0 });
    const tick = advanceWorld(normalizeGameState(JSON.parse(JSON.stringify(collected.state))), 100);
    expect(tick.events.filter((event) => event.category === "sales")).toEqual([]);
    expect(tick.state.franchises[0].registerCashMinor).toEqual([0, 0]);
    expect(tick.state.balanceMinor).toBe(collected.state.balanceMinor);
  });

  it("does not spend register funds on building work", () => {
    const initial = createInitialGame();
    initial.balanceMinor = 0;
    initial.franchises[0].registerCashMinor = [100_000, 0];
    const blocked = applyGameAction(initial, { type: "CONTRIBUTE_BUILD", amountMinor: 500 });
    expect(blocked.ok).toBe(false);
    expect(blocked.state.franchises[0].registerCashMinor).toEqual([100_000, 0]);
  });

  it("collects the selected lane without touching the other one or another shop", () => {
    const initial = createInitialGame();
    initial.franchises[0].registerCashMinor = [400, 900];
    initial.franchises[1].registerCashMinor = [700, 0];
    const result = applyGameAction(initial, { type: "COLLECT_REGISTER", lane: 1 });
    expect(result.state.balanceMinor).toBe(initial.balanceMinor + 900);
    expect(result.state.franchises[0].registerCashMinor).toEqual([400, 0]);
    expect(result.state.franchises[1].registerCashMinor).toEqual([700, 0]);
  });

  it("processes repeated proximity pulses atomically inside one world tick", () => {
    const initial = createInitialGame();
    initial.franchises[0].registerCashMinor = [700, 0];
    const result = advanceWorld(initial, 0, undefined, { interactions: [{ type: "COLLECT_REGISTER", lane: 0 }, { type: "COLLECT_REGISTER", lane: 0 }] });
    expect(result.state.balanceMinor).toBe(initial.balanceMinor + 700);
    expect(result.events.filter((event) => event.category === "cash_collection")).toHaveLength(1);
    expect(validateSaveTransition(initial, result.state, result.events)).toEqual({ ok: true });
  });

  it("rejects an unrecorded transfer even if total wealth is unchanged", () => {
    const initial = createInitialGame();
    initial.franchises[0].registerCashMinor = [700, 0];
    const forged = structuredClone(initial);
    forged.balanceMinor += 700;
    forged.franchises[0].registerCashMinor[0] = 0;
    expect(validateSaveTransition(initial, forged, [])).toEqual({ ok: false, code: "INVALID_BALANCE_DELTA" });
  });

  it("rejects cash transported between lanes without collection", () => {
    const initial = createInitialGame();
    initial.franchises[0].registerCashMinor = [700, 0];
    const forged = structuredClone(initial);
    forged.franchises[0].registerCashMinor = [0, 700];
    expect(validateSaveTransition(initial, forged, [])).toEqual({ ok: false, code: "INVALID_BALANCE_DELTA" });
  });

  it("rejects a missing balance instead of silently discarding pending money", () => {
    const initial = createInitialGame();
    initial.franchises[0].registerCashMinor = [700, 0];
    const restoredLegacy = savePayloadSchema.parse({ ...payload(initial), state: preRegisterChecksumState(initial) }).state as GameState;
    expect(validateSaveTransition(initial, restoredLegacy, [])).toEqual({ ok: false, code: "INVALID_BALANCE_DELTA" });
  });

  it("migrates old snapshots without recounting historical sales", () => {
    const initial = createInitialGame();
    initial.balanceMinor = 456_789;
    initial.finances.grossRevenueMinor = 123_456;
    const legacy = preRegisterChecksumState(initial);
    expect(isPreRegisterSnapshot(legacy)).toBe(true);
    const restored = normalizeGameState(legacy);
    expect(isPreRegisterSnapshot(restored)).toBe(false);
    expect(restored.balanceMinor).toBe(initial.balanceMinor);
    expect(restored.franchises.every((franchise) => franchise.registerCashMinor.every((value) => value === 0))).toBe(true);
    expect(preRegisterChecksumState(savePayloadSchema.parse({ ...payload(initial), state: legacy }).state as GameState)).toEqual(legacy);
  });

  it("preserves the serialized old server shape when acknowledging a lost response", () => {
    const canonical = savePayloadSchema.parse(payload(createInitialGame())).state as GameState;
    const oldStored = preRegisterChecksumState(canonical);
    const oldWire = JSON.parse(JSON.stringify(oldStored));
    const parsedAgain = savePayloadSchema.parse({ ...payload(canonical), state: oldWire }).state as GameState;
    expect(JSON.stringify(preRegisterChecksumState(parsedAgain))).toBe(JSON.stringify(oldStored));
    expect(isPreRegisterSnapshot(parsedAgain)).toBe(false);
  });

  it.each([-1, 0.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects invalid pending money (%s) at the API boundary", (value) => {
    const initial = createInitialGame();
    initial.franchises[0].registerCashMinor[0] = value;
    expect(savePayloadSchema.safeParse(payload(initial)).success).toBe(false);
  });

  it("accepts unsent old wallet sales only when the server enables the one-way migration", () => {
    const initial = readyPayment();
    const sale = advanceWorld(initial, 1_000);
    const amount = sale.state.franchises[0].registerCashMinor[0];
    const old = structuredClone(sale.state);
    old.franchises[0].registerCashMinor[0] = 0;
    old.balanceMinor += amount;
    const oldEvents = sale.events.map((event) => ({ ...event, payload: { transactionId: event.payload?.transactionId } }));
    expect(validateSaveTransition(initial, old, oldEvents).ok).toBe(false);
    expect(validateSaveTransition(initial, old, oldEvents, { allowLegacyWalletSales: true })).toEqual({ ok: true });
  });
});
