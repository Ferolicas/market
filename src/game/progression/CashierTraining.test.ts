import { describe, expect, it } from "vitest";
import { applyGameAction, checkoutBagInterval, checkoutScanInterval, CHECKOUT_BAG_UNIT_MS, CHECKOUT_SCAN_UNIT_MS, createCampaignGame, normalizeGameState } from "../engine";
import { cashierTillModifiers, employeeCarryCapacity, employeeWalkSpeed } from "./EmployeeStats";
import { OPENING_PURCHASES } from "./MartCampaign";
import { rosterEntries } from "./RosterUpgrades";
import { validateSaveTransition } from "../persistence/SaveAuthority";

const till = { stationTiers: { "checkout-1": 1 }, checkoutLevel: 1, shelvesLevel: 1 };

describe("cashier training at the till", () => {
  it("shortens the scan interval with every trained level, on top of the till tier", () => {
    const untrained = checkoutScanInterval(till, { checkoutLane: 0 }, { level: 1 });
    expect(untrained).toBe(CHECKOUT_SCAN_UNIT_MS);
    expect(checkoutScanInterval(till, { checkoutLane: 0 })).toBe(CHECKOUT_SCAN_UNIT_MS);
    let previous = untrained;
    for (const level of [2, 3, 4, 5]) {
      const interval = checkoutScanInterval(till, { checkoutLane: 0 }, { level });
      expect(interval).toBeLessThanOrEqual(previous);
      expect(interval).toBe(CHECKOUT_SCAN_UNIT_MS / cashierTillModifiers(level).speed);
      previous = interval;
    }
    expect(checkoutScanInterval(till, { checkoutLane: 0 }, { level: 5 })).toBeLessThan(untrained);
    expect(checkoutScanInterval({ ...till, stationTiers: { "checkout-1": 3 } }, { checkoutLane: 0 }, { level: 5 }))
      .toBeLessThan(checkoutScanInterval(till, { checkoutLane: 0 }, { level: 5 }));
  });

  it("bags faster with the trained capacity", () => {
    expect(checkoutBagInterval()).toBe(CHECKOUT_BAG_UNIT_MS);
    expect(checkoutBagInterval({ level: 1 })).toBe(CHECKOUT_BAG_UNIT_MS);
    expect(checkoutBagInterval({ level: 2 })).toBeLessThan(CHECKOUT_BAG_UNIT_MS);
    expect(checkoutBagInterval({ level: 5 })).toBeLessThan(checkoutBagInterval({ level: 2 }));
  });

  it("trains the cashier from the team panel and prints the real till speed", () => {
    let state = createCampaignGame();
    state.balanceMinor = 1_000_000;
    state.franchises[0].purchases!.purchased = OPENING_PURCHASES.slice(0, 4).map((purchase) => purchase.id);
    state = normalizeGameState(JSON.parse(JSON.stringify(state)));
    const cashier = state.franchises[0].employees.find((employee) => employee.role === "cashier")!;
    expect(cashier).toBeDefined();
    const card = () => rosterEntries(state.franchises[0], 1).find((entry) => entry.id === `employee:${cashier.id}`)!;
    expect(card().detail).toBe("Cajero · escaneo ×1.00");
    for (let step = 1; step <= 4; step += 1) {
      const result = applyGameAction(state, { type: "UPGRADE_ROSTER", entryId: `employee:${cashier.id}` });
      expect(result.ok, `step ${step}`).toBe(true);
      expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
      state = result.state;
    }
    const trained = state.franchises[0].employees.find((employee) => employee.id === cashier.id)!;
    expect(trained.level).toBe(5);
    expect(card().detail).toBe(`Cajero · escaneo ×${cashierTillModifiers(5).speed.toFixed(2)}`);
    expect(card().speed).toBe(cashierTillModifiers(5).speed);
    expect(checkoutScanInterval(state.franchises[0], { checkoutLane: 0 }, trained)).toBeLessThan(CHECKOUT_SCAN_UNIT_MS);
  });

  it("prints the real basket and pace of a trained farmer", () => {
    let state = createCampaignGame();
    state.balanceMinor = 1_000_000;
    state.franchises[0].purchases!.purchased = ["farmer-1"];
    state = normalizeGameState(JSON.parse(JSON.stringify(state)));
    const farmer = state.franchises[0].employees.find((employee) => employee.role === "farmer")!;
    const card = () => rosterEntries(state.franchises[0], 1).find((entry) => entry.id === `employee:${farmer.id}`)!;
    expect(card()).toMatchObject({ detail: "Granjero-reponedor · cesta 3", speed: 1, capacity: 1 });
    state = applyGameAction(state, { type: "UPGRADE_ROSTER", entryId: `employee:${farmer.id}` }).state;
    expect(card().detail).toBe(`Granjero-reponedor · cesta ${employeeCarryCapacity(2)}`);
    expect(card().capacity).toBeCloseTo(employeeCarryCapacity(2) / employeeCarryCapacity(1), 2);
    expect(card().speed).toBeCloseTo(employeeWalkSpeed(2) / employeeWalkSpeed(1), 2);
  });
});
