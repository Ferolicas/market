import { describe, expect, it } from "vitest";
import { applyGameAction, createInitialGame } from "../engine";
import { validateSaveTransition } from "./SaveAuthority";

describe("server save authority", () => {
  it("accepts the exact event chain and matching money delta", () => {
    const current = createInitialGame();
    const result = applyGameAction(current, { type: "SET_COUNTRY", countryCode: "CO" });
    expect(validateSaveTransition(current, result.state, result.events)).toEqual({ ok: true });
  });

  it("rejects a forged balance, replayed sequence and removed inventory", () => {
    const current = createInitialGame();
    const result = applyGameAction(current, { type: "CONTRIBUTE_BUILD", amountMinor: 500 });
    expect(validateSaveTransition(current, { ...result.state, balanceMinor: result.state.balanceMinor + 1 }, result.events)).toEqual({ ok: false, code: "INVALID_BALANCE_DELTA" });
    expect(validateSaveTransition(current, result.state, result.events.map((event) => ({ ...event, sequence: 10 })))).toEqual({ ok: false, code: "INVALID_SEQUENCE" });
    const invalid = structuredClone(result.state); invalid.franchises[0].warehouse.tomatoes = -1;
    expect(validateSaveTransition(current, invalid, result.events)).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });
  });

  it("does not allow changing the registered country in a later save", () => {
    const initial = createInitialGame();
    const registration = applyGameAction(initial, { type: "SET_COUNTRY", countryCode: "ES" });
    const tampered = structuredClone(registration.state); tampered.countryCode = "US"; tampered.currency = "USD";
    expect(validateSaveTransition(registration.state, tampered, [])).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });
  });
});
