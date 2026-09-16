import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, CHECKOUT_SCAN_UNIT_MS, createCampaignGame, normalizeGameState } from "../engine";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import { CAMPAIGN_PRICE_GROWTH_PER_LEVEL, campaignLevel, campaignPriceMultiplier } from "../progression/CampaignLevels";
import { OPENING_PURCHASES } from "../progression/MartCampaign";
import { CHECKOUT_LANES } from "../stations/checkout-layout";
import type { CheckoutTransaction, CustomerRuntimeState, GameState } from "../types";

/** A customer already at the till with one tomato on the belt. */
function addTomatoCheckout(state: GameState, id: string) {
  const lane = CHECKOUT_LANES[0];
  state.franchises[0].customers.push({
    id, identity: 1, state: "WAIT_CHECKOUT", shoppingList: [{ productId: "tomatoes", requested: 1, picked: 1 }], currentLine: 1,
    basket: { tomatoes: 1 }, patienceMs: 10_000, checkoutPatienceMs: 300_000, waitingSince: null, queueSlot: 0, transactionId: `${id}-tx`, hasCart: true, hasBag: false, angry: false,
    x: lane.customerFront[0], z: lane.customerFront[1], targetX: lane.customerFront[0], targetZ: lane.customerFront[1], path: [], pathIndex: 0, speed: 1.4, stateSince: state.simulationTimeMs, reservedSocketId: null, blockedSince: null, routeFailures: 0, queueLane: 0,
  } satisfies CustomerRuntimeState);
  state.franchises[0].checkoutTransactions.push({
    id: `${id}-tx`, customerId: id, pendingItems: [{ productId: "tomatoes", quantity: 1, loaded: 1, scanned: 0, bagged: 0 }], paymentMethod: "card",
    state: "SCANNING", nextUnitIndex: 0, paymentCommitted: false, updatedAt: state.simulationTimeMs,
    lastLoadedAt: state.simulationTimeMs, lastScannedAt: state.simulationTimeMs - CHECKOUT_SCAN_UNIT_MS, lastBaggedAt: state.simulationTimeMs, checkoutLane: 0,
  } satisfies CheckoutTransaction);
}

function campaignAtLevel(level: number) {
  const state = createCampaignGame();
  state.tutorialStep = 1;
  state.franchises[0].purchases!.purchased = OPENING_PURCHASES.slice(0, level - 1).map((purchase) => purchase.id);
  const restored = normalizeGameState(JSON.parse(JSON.stringify(state)));
  expect(campaignLevel(restored.franchises[0])).toBe(level);
  restored.franchises[0].open = true;
  restored.franchises[0].lastCustomerSpawnAt = 999_999;
  return restored;
}

function sellOneTomato(state: GameState) {
  addTomatoCheckout(state, `sale-${state.level}`);
  let current = applyGameAction(state, { type: "CHECKOUT", paymentMethod: "card" });
  expect(current.ok, current.message).toBe(true);
  const events = [...current.events];
  let next = current.state;
  for (let second = 0; second < 6 && !next.franchises[0].checkoutTransactions[0]?.paymentCommitted; second += 1) {
    current = advanceWorld(next, 1_000);
    next = current.state;
    events.push(...current.events);
  }
  const sale = events.find((event) => event.category === "sales");
  expect(sale, "sale event").toBeDefined();
  expect(validateSaveTransition(state, next, events)).toEqual({ ok: true });
  return { amountMinor: sale!.amountMinor, till: next.franchises[0].registerCashMinor[0] };
}

describe("campaign prices grow with the level", () => {
  it("compounds three percent per level from the base price at level one", () => {
    expect(CAMPAIGN_PRICE_GROWTH_PER_LEVEL).toBe(0.03);
    expect(campaignPriceMultiplier(1)).toBe(1);
    expect(campaignPriceMultiplier(2)).toBeCloseTo(1.03, 6);
    expect(campaignPriceMultiplier(7)).toBeCloseTo(1.03 ** 6, 6);
    expect(campaignPriceMultiplier(30)).toBeCloseTo(1.03 ** 29, 6);
    expect(campaignPriceMultiplier(0)).toBe(1);
    expect(campaignPriceMultiplier(99)).toBe(campaignPriceMultiplier(30));
  });

  it("charges the level price at the till and the server accepts the sale", () => {
    expect(sellOneTomato(campaignAtLevel(1))).toEqual({ amountMinor: 100, till: 100 });
    // Level 7: 1,00 € × 1,03⁶ = 1,194 € → 1,19 €.
    expect(sellOneTomato(campaignAtLevel(7))).toEqual({ amountMinor: 119, till: 119 });
    expect(sellOneTomato(campaignAtLevel(12))).toEqual({ amountMinor: Math.round(100 * 1.03 ** 11), till: Math.round(100 * 1.03 ** 11) });
  });
});
