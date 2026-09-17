import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, createInitialGame, normalizeGameState } from "../engine";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import { BUSINESS_DAY_NIGHT_MINUTE, BUSINESS_DAY_OPEN_MINUTE } from "./BusinessDay";

describe("independent store clocks", () => {
  it("does not spend a closed store's morning while another is open, including reload and travel", () => {
    let state = createInitialGame();
    const second = state.franchises[1]; second.owned = true;
    state.franchises[0].open = true;
    state.minuteOfDay = 540;
    state = advanceWorld(state, 1_000).state;
    const firstMinute = state.minuteOfDay;
    state = normalizeGameState(JSON.parse(JSON.stringify(state)));
    state = applyGameAction(state, { type: "TRAVEL", franchiseId: second.id }).state;
    expect(state.minuteOfDay).toBe(BUSINESS_DAY_OPEN_MINUTE);
    state = applyGameAction(state, { type: "TRAVEL", franchiseId: state.franchises[0].id }).state;
    expect(state.minuteOfDay).toBe(firstMinute);
  });
  it("closes and settles only the store whose day ends", () => {
    const state = createInitialGame();
    state.minuteOfDay = BUSINESS_DAY_NIGHT_MINUTE;
    state.franchises[0].open = true;
    Object.assign(state.franchises[1], { owned: true, open: true, businessDay: 3, businessMinute: 540, lastCustomerSpawnAt: 999_999 });
    const next = advanceWorld(state, 500).state;
    expect(next.franchises[0]).toMatchObject({ open: false, businessDay: 2, businessMinute: BUSINESS_DAY_OPEN_MINUTE });
    expect(next.franchises[1]).toMatchObject({ open: true, businessDay: 3 });
    expect(next.franchises[1].businessMinute).toBeGreaterThan(540);
    expect(next.franchises[1].businessMinute).toBeLessThan(541);
  });
  it("accepts travelling from day nine to another store's first day without permitting a local day rollback", () => {
    const state = normalizeGameState(createInitialGame());
    state.day = 9; state.franchises[0].businessDay = 9;
    state.franchises[1].owned = true;
    const result = applyGameAction(state, { type: "TRAVEL", franchiseId: state.franchises[1].id });
    expect(result.state.day).toBe(1);
    expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
    result.state.franchises[0].businessDay = 8;
    expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: false, code: "INVALID_STATE_TRANSITION" });
  });

});
