import { describe, expect, it } from "vitest";
import { advanceSimulation, applyGameAction, createInitialGame } from "../engine";
import { validateSaveTransition } from "./SaveAuthority";

describe("server save authority", () => {
  it("accepts the exact event chain and matching money delta", () => {
    const current = createInitialGame();
    const result = applyGameAction(current, { type: "SET_COUNTRY", countryCode: "CO" });
    expect(validateSaveTransition(current, result.state, result.events)).toEqual({ ok: true });
    expect(result.events[0]).toMatchObject({
      franchiseId: current.currentFranchiseId,
      payload: { scope: "global", countryCode: "CO" },
    });
  });

  it("rejects event attribution to an unknown or unowned franchise", () => {
    const current = createInitialGame();
    const ordered = applyGameAction(current, { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 1 });
    const unknown = ordered.events.map((event) => ({ ...event, franchiseId: "forged-branch" }));
    const unowned = ordered.events.map((event) => ({ ...event, franchiseId: current.franchises[1].id }));

    expect(validateSaveTransition(current, ordered.state, unknown)).toEqual({ ok: false, code: "INVALID_EVENTS" });
    expect(validateSaveTransition(current, ordered.state, unowned)).toEqual({ ok: false, code: "INVALID_EVENTS" });
  });

  it("rejects a forged balance, replayed sequence and removed inventory", () => {
    const current = createInitialGame();
    const result = applyGameAction(current, { type: "CONTRIBUTE_BUILD", amountMinor: 500 });
    expect(validateSaveTransition(current, { ...result.state, balanceMinor: result.state.balanceMinor + 1 }, result.events)).toEqual({ ok: false, code: "INVALID_BALANCE_DELTA" });
    expect(validateSaveTransition(current, result.state, result.events.map((event) => ({ ...event, sequence: 10 })))).toEqual({ ok: false, code: "INVALID_SEQUENCE" });
    const invalid = structuredClone(result.state); invalid.franchises[0].warehouse.tomatoes = -1;
    expect(validateSaveTransition(current, invalid, result.events)).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects an over-capacity, negative or unknown product in the mixed carry basket", () => {
    const current = createInitialGame();
    const overCapacity = structuredClone(current);
    overCapacity.franchises[0].carry = { capacity: 3, items: { tomatoes: 2, wheat: 2 } };
    expect(validateSaveTransition(current, overCapacity, [])).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });

    const negative = structuredClone(current);
    negative.franchises[0].carry.items.tomatoes = -1;
    expect(validateSaveTransition(current, negative, [])).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });

    const unknown = structuredClone(current);
    (unknown.franchises[0].carry.items as Record<string, number>).potatoes = 1;
    expect(validateSaveTransition(current, unknown, [])).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });

    const oversizedContainer = structuredClone(current);
    oversizedContainer.franchises[0].carry = { capacity: 21, items: {} };
    expect(validateSaveTransition(current, oversizedContainer, [])).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });
  });

  it("applies the v4 carry invariants to every persisted employee runtime", () => {
    const current = createInitialGame();
    current.level = 5;
    const hired = applyGameAction(current, { type: "HIRE", role: "stocker" });
    expect(hired.ok).toBe(true);
    expect(validateSaveTransition(current, hired.state, hired.events)).toEqual({ ok: true });

    const overCapacity = structuredClone(hired.state);
    overCapacity.franchises[0].employees[0].runtime!.carry = { capacity: 2, items: { tomatoes: 2, apples: 1 } };
    expect(validateSaveTransition(current, overCapacity, hired.events)).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });

    const negative = structuredClone(hired.state);
    negative.franchises[0].employees[0].runtime!.carry.items.tomatoes = -1;
    expect(validateSaveTransition(current, negative, hired.events)).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });

    const unknown = structuredClone(hired.state);
    (unknown.franchises[0].employees[0].runtime!.carry.items as Record<string, number>).potatoes = 1;
    expect(validateSaveTransition(current, unknown, hired.events)).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });

    const missingItems = structuredClone(hired.state);
    delete (missingItems.franchises[0].employees[0].runtime!.carry as { items?: unknown }).items;
    expect(validateSaveTransition(current, missingItems, hired.events)).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });
  });

  it("accepts a persisted supplier delivery and capacity-safe warehouse pickup", () => {
    const current = createInitialGame("ES");
    const ordered = applyGameAction(current, { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 10 });
    const delivered = advanceSimulation(ordered.state, 80);
    const pickedUp = applyGameAction(delivered.state, { type: "PICKUP_WAREHOUSE" });
    const stocked = applyGameAction(pickedUp.state, { type: "STOCK", productId: "wheat", quantity: 3, source: "carry" });

    expect(ordered.ok && delivered.ok && pickedUp.ok && stocked.ok).toBe(true);
    expect(validateSaveTransition(current, stocked.state, ordered.events)).toEqual({ ok: true });
    expect(stocked.state.franchises[0].warehouse.wheat + stocked.state.franchises[0].shelves.wheat).toBe(10);
  });

  it("does not allow changing the registered country in a later save", () => {
    const initial = createInitialGame();
    const registration = applyGameAction(initial, { type: "SET_COUNTRY", countryCode: "ES" });
    const tampered = structuredClone(registration.state); tampered.countryCode = "US"; tampered.currency = "USD";
    expect(validateSaveTransition(registration.state, tampered, [])).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });
  });
});
