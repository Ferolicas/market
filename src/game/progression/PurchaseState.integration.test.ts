import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, campaignPurchaseQuotes, canHireEmployee, createCampaignGame, createInitialGame, normalizeGameState, upgradeQuote } from "../engine";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import { OPENING_PURCHASES } from "./MartCampaign";
import { migratePurchases } from "./PurchaseState";
import { savePayloadSchema } from "../../lib/game-validation";
import { CAMPAIGN_TASKS } from "./CampaignTasks";

describe("purchases connected to game state", () => {
  it("does not enroll or inherit an old save through a purchase", () => {
    const legacy = normalizeGameState({ ...createInitialGame(), level: 21 });
    const before = structuredClone(legacy);
    expect(campaignPurchaseQuotes(legacy)).toEqual([]);
    expect(applyGameAction(legacy, { type: "CONTRIBUTE_PURCHASE", purchaseId: "cow-1", amountMinor: 100_000 }).ok).toBe(false);
    expect(legacy).toEqual(before);
    const forged = structuredClone(legacy);
    forged.franchises[0].purchases = migratePurchases(legacy.franchises[0], legacy.level);
    expect(validateSaveTransition(legacy, forged, []).ok).toBe(false);
    const fresh = createCampaignGame();
    expect(fresh.level).toBe(1);
    expect(fresh.franchises[0].purchases?.purchased).toEqual([]);
    expect(fresh.franchises[0].purchases?.inherited).toEqual([]);
    expect(fresh.franchises[0].employees).toEqual([]);
  });
  it("gates legacy hiring and upgrades by purchases, not accumulated levels", () => {
    let state = createCampaignGame();
    // This fixture isolates hiring gates after personal work was completed.
    state.franchises[0].purchases!.personalProgress = Object.fromEntries(Object.entries(CAMPAIGN_TASKS).map(([id, task]) => [id, task.target]));
    state.balanceMinor = 10_000_000;
    state.level = 30;
    for (const role of ["cashier", "farmer", "operator", "stocker", "builder", "manager"] as const) {
      expect(canHireEmployee(state, role)).toBe(false);
      expect(applyGameAction(state, { type: "HIRE", role }).ok).toBe(false);
    }
    for (const upgrade of ["expansion", "mill", "bakery"] as const) {
      expect(applyGameAction(state, { type: "UPGRADE", upgrade }).ok).toBe(false);
    }
    expect(upgradeQuote(state, "player-speed")).toBeNull();
    expect(upgradeQuote(state, "player-capacity")).toBeNull();
    for (const purchaseId of ["farmer-1", "egg-display-1", "chicken-1", "player-2", "tomato-2", "farmer-2", "expansion-1", "wheat-1", "flour-mill-1"] as const) {
      state = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId, amountMinor: 10_000_000 }).state;
    }
    state.level = 1;
    state = normalizeGameState(JSON.parse(JSON.stringify(state)));
    expect(upgradeQuote(state, "player-speed")?.currentTier).toBe(2);
    expect(upgradeQuote(state, "player-capacity")).not.toBeNull();
    // The mill brings its operator: the desk is granted and already filled,
    // so nothing is hired by hand.
    expect(state.franchises[0].employees.filter((employee) => employee.role === "operator")).toHaveLength(1);
    expect(canHireEmployee(state, "operator")).toBe(false);
    expect(canHireEmployee(state, "farmer")).toBe(false);
    expect(applyGameAction(state, { type: "HIRE", role: "operator" }).ok).toBe(false);
    state.franchises[0].stationTiers = { "chicken-coop-1": 1, "cow-station-1": 1, "bread-oven-1": 1 };
    expect(upgradeQuote(state, "station")).toBeNull();
  });
  it("allows initial country selection without creating capital or losing purchase state", () => {
    const initial = createCampaignGame();
    const configured = applyGameAction(initial, { type: "SET_COUNTRY", countryCode: "CO" });
    expect(configured.ok).toBe(true);
    expect(configured.state.balanceMinor).toBe(0);
    expect(validateSaveTransition(initial, configured.state, configured.events)).toEqual({ ok: true });
  });
  it("starts without free stock or money and restores without legacy level unlocks", () => {
    const state = createCampaignGame();
    expect(state.balanceMinor).toBe(0);
    expect(Object.values(state.franchises[0].shelves).every((quantity) => quantity === 0)).toBe(true);
    state.level = 30;
    const restored = normalizeGameState(state);
    expect(restored.franchises[0].employees).toEqual([]);
    expect(restored.franchises[0].productionMachines.every((machine) => machine.status === "LOCKED")).toBe(true);
  });
  it("grows eight tomatoes repeatedly and caps the opening at two small-basket customers", () => {
    let state = createCampaignGame();
    state.franchises[0].open = true;
    for (let tick = 0; tick < 30; tick++) state = advanceWorld(state, 1_000).state;
    expect(state.franchises[0].crops[0].available).toBe(8);
    expect(state.franchises[0].customers).toHaveLength(2);
    expect(state.franchises[0].customers.every((customer) => customer.shoppingList.length === 1 && customer.shoppingList[0].requested <= 2)).toBe(true);
    state.franchises[0].carry.capacity = 8;
    const harvest = applyGameAction(state, { type: "HARVEST", cropId: "crop-tomato-1", quantity: 8 });
    expect(harvest.ok).toBe(true);
    state = normalizeGameState(JSON.parse(JSON.stringify(harvest.state)));
    for (let tick = 0; tick < 4; tick++) state = advanceWorld(state, 1_000).state;
    expect(state.franchises[0].crops[0].available).toBe(8);
  });

  it("persists partial payment, hires exactly once, and passes server validation", () => {
    const initial = createCampaignGame();
    initial.balanceMinor = 10_000;
    const first = applyGameAction(initial, { type: "CONTRIBUTE_PURCHASE", purchaseId: "farmer-1", amountMinor: 1_000 });
    expect(first.ok).toBe(true);
    expect(first.state.franchises[0].employees).toHaveLength(0);
    expect(validateSaveTransition(initial, first.state, first.events)).toEqual({ ok: true });
    const restored = normalizeGameState(JSON.parse(JSON.stringify(first.state)));
    expect(campaignPurchaseQuotes(restored)[0].remainingMinor).toBe(1_000);
    const finish = applyGameAction(restored, { type: "CONTRIBUTE_PURCHASE", purchaseId: "farmer-1", amountMinor: 10_000 });
    expect(finish.state.balanceMinor).toBe(8_000);
    expect(finish.state.franchises[0].employees.filter((employee) => employee.role === "farmer")).toHaveLength(1);
    expect(validateSaveTransition(first.state, finish.state, finish.events)).toEqual({ ok: true });
    expect(applyGameAction(finish.state, { type: "CONTRIBUTE_PURCHASE", purchaseId: "farmer-1" }).ok).toBe(false);
  });

  it("applies every purchase to real stations without charging twice on reload", () => {
    let state = createCampaignGame();
    // Personal work is exercised through real actions in CampaignTasks.test.ts.
    state.franchises[0].purchases!.personalProgress = Object.fromEntries(Object.entries(CAMPAIGN_TASKS).map(([id, task]) => [id, task.target]));
    state.balanceMinor = 10_000_000;
    for (const purchase of OPENING_PURCHASES) {
      const result = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId: purchase.id, amountMinor: 10_000_000 });
      expect(result.ok, purchase.id).toBe(true);
      expect(validateSaveTransition(state, result.state, result.events), purchase.id).toEqual({ ok: true });
      state = normalizeGameState(JSON.parse(JSON.stringify(result.state)));
    }
    expect(state.franchises[0].crops.filter((crop) => crop.status !== "LOCKED")).toHaveLength(8);
    expect(state.franchises[0].productionMachines.filter((machine) => machine.status !== "LOCKED")).toHaveLength(8);
    // Every farmer desk, the second farm and each new crop bring a farmer;
    // every pen its feeder; every machine its operator.
    expect(state.franchises[0].employees.filter((employee) => employee.role === "farmer")).toHaveLength(8);
    expect(state.franchises[0].employees.filter((employee) => employee.role === "feeder")).toHaveLength(3);
    // Levels 5, 10 and 20 arrive along the way and hand over their cashiers.
    expect(state.franchises[0].employees.filter((employee) => employee.role === "cashier")).toHaveLength(3);
    expect(state.franchises[0].employees.filter((employee) => employee.role === "operator")).toHaveLength(5);
    expect(state.franchises[0].purchases?.purchased).toHaveLength(OPENING_PURCHASES.length);
    expect(applyGameAction(state, { type: "CONTRIBUTE_BUILD" }).ok).toBe(false);
  });

  it("preserves inherited ownership, avatar, goods and wallet when inspecting legacy purchases", () => {
    const legacy = createInitialGame();
    legacy.level = 21;
    const restored = normalizeGameState(legacy);
    const before = structuredClone(restored);
    const inherited = migratePurchases(restored.franchises[0], restored.level);
    expect(inherited.purchased).toContain("juice-machine-1");
    expect(inherited.purchased).toContain("coffee-supply-1");
    expect(restored).toEqual(before);
  });

  it("rejects forged inherited purchases, contributions and deleted purchase state", () => {
    const initial = createCampaignGame();
    initial.balanceMinor = 10_000;
    const paid = applyGameAction(initial, { type: "CONTRIBUTE_PURCHASE", purchaseId: "farmer-1", amountMinor: 1_000 });
    for (const mutate of [
      (state: typeof initial) => { state.franchises[0].purchases!.inherited.push("cow-1"); },
      (state: typeof initial) => { state.franchises[0].purchases!.contributions["farmer-1"] = 2_000; },
      (state: typeof initial) => { delete state.franchises[0].purchases; },
    ]) {
      const forged = structuredClone(paid.state);
      mutate(forged);
      expect(validateSaveTransition(initial, forged, paid.events).ok).toBe(false);
    }
    const payload = { expectedRevision: 0, operationId: "22222222-2222-4222-8222-222222222222", deviceId: "33333333-3333-4333-8333-333333333333", sessionId: "11111111-1111-4111-8111-111111111111", state: paid.state, events: paid.events };
    expect(savePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("lets the first farmer harvest, collect eggs and stock shelves without feeding animals", () => {
    let state = createCampaignGame();
    state.balanceMinor = 100_000;
    for (const purchaseId of ["farmer-1", "egg-display-1", "chicken-1"] as const) {
      state = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId, amountMinor: 100_000 }).state;
    }
    const chicken = state.franchises[0].productionMachines.find((machine) => machine.id === "chicken-coop-1")!;
    chicken.output = 3; chicken.status = "OUTPUT_READY";
    state.franchises[0].warehouse.tomatoes = 10;
    // The coop's own feeder is parked so only the farmer's behaviour is measured.
    for (const employee of state.franchises[0].employees) if (employee.role === "feeder") employee.runtime!.stateSince = Number.MAX_SAFE_INTEGER;
    for (let tick = 0; tick < 2_000; tick++) {
      state = advanceWorld(state, 100).state;
      if (tick === 300) state = normalizeGameState(JSON.parse(JSON.stringify(state)));
    }
    const franchise = state.franchises[0];
    expect(franchise.shelves.tomatoes).toBeGreaterThan(0);
    expect(franchise.shelves.eggs).toBe(3);
    expect(franchise.productionMachines.find((machine) => machine.id === "chicken-coop-1")!.input.tomatoes ?? 0).toBe(0);
    expect(state.progression.counters["feed:chicken"] ?? 0).toBe(0);
    expect(state.progression.counters["production:eggs"] ?? 0).toBe(0);
    expect(franchise.employees.find((employee) => employee.role === "farmer")!.runtime!.carry.capacity).toBe(3);
  });
});
