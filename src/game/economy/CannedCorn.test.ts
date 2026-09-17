import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, canOrderProduct, createCampaignGame, createInitialGame, normalizeGameState, shelfCapacityForTier } from "../engine";
import { OPENING_PURCHASES, campaignAvailableProducts } from "../progression/MartCampaign";
import { CAMPAIGN_TASK_IDS, campaignTaskTarget } from "../progression/CampaignTasks";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import { retailServicePoint } from "../stations/retail-layout";
import { ensureStoreNavigation, isStoreNavigationPoint, storePathfinder } from "../navigation/NavMeshService";
import { STORE_LAYOUT_SCALE, storeObstaclesForAreas } from "../world-scale";
import { productionFixtureForWorkstation } from "../stations/production-layout";

function prepared() {
  let state = createCampaignGame();
  state.balanceMinor = 10_000_000;
  state.franchises[0].purchases!.personalProgress = Object.fromEntries(CAMPAIGN_TASK_IDS.map((id) => [id, campaignTaskTarget(id)]));
  for (const purchase of OPENING_PURCHASES) {
    const result = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId: purchase.id, amountMinor: 10_000_000 });
    expect(result.ok).toBe(true);
    expect(validateSaveTransition(state, result.state, result.events)).toEqual({ ok: true });
    state = result.state;
  }
  // Isolate supplier flow from employees moving stock during the delivery tick.
  state.franchises[0].employees = [];
  return state;
}

describe("canned corn supplier chain", () => {
  it("lets an operator fetch warehouse corn, produce and return cans without waiting for farmers", async () => {
    let state = prepared();
    const franchise = state.franchises[0];
    franchise.productionMachines = franchise.productionMachines.filter((item) => item.id === "corn-canner-1");
    franchise.warehouse.corn = 1;
    franchise.crops = [];
    franchise.shelves.corn = shelfCapacityForTier(1, "corn", franchise.unlockedAreas);
    franchise.shelves.cannedCorn = shelfCapacityForTier(1, "cannedCorn", franchise.unlockedAreas);
    franchise.employees = [{ id: "canner-operator", name: "Luna", role: "operator", level: 1, salaryMinor: 0, energy: 100, hat: "frog" }];
    await ensureStoreNavigation(91_225, franchise.unlockedAreas);
    for (let tick = 0; tick < 240 && state.franchises[0].warehouse.cannedCorn < 3; tick++) {
      state = advanceWorld(state, 1_000, storePathfinder).state;
    }
    expect(state.franchises[0].warehouse.corn).toBe(0);
    expect(state.franchises[0].warehouse.cannedCorn).toBe(3);
  });
  it("converts one carried corn into three cans, survives mid-cycle reload and never duplicates a batch", () => {
    let state = prepared();
    state.franchises[0].warehouse.corn = 1;
    const pickup = applyGameAction(state, { type: "PICKUP_WAREHOUSE", productId: "corn", quantity: 1 });
    const loaded = applyGameAction(pickup.state, { type: "OPERATE_MACHINE", machineId: "corn-canner-1" });
    expect(loaded.ok).toBe(true);
    expect(loaded.state.franchises[0].carry.items.corn ?? 0).toBe(0);
    expect(validateSaveTransition(state, loaded.state, [...pickup.events, ...loaded.events])).toEqual({ ok: true });
    expect(applyGameAction(loaded.state, { type: "OPERATE_MACHINE", machineId: "corn-canner-1" }).ok).toBe(false);
    state = normalizeGameState(JSON.parse(JSON.stringify(loaded.state)));
    for (let tick = 0; tick < 6; tick++) state = advanceWorld(state, 1_000).state;
    const machine = state.franchises[0].productionMachines.find((item) => item.id === "corn-canner-1")!;
    expect(machine.output).toBe(3);
    const collected = applyGameAction(state, { type: "OPERATE_MACHINE", machineId: machine.id });
    expect(collected.ok).toBe(true);
    expect(collected.state.franchises[0].carry.items.cannedCorn).toBe(3);
    expect(validateSaveTransition(state, collected.state, collected.events)).toEqual({ ok: true });
    const duplicate = applyGameAction(normalizeGameState(JSON.parse(JSON.stringify(collected.state))), { type: "OPERATE_MACHINE", machineId: machine.id });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.state.franchises[0].carry.items.cannedCorn).toBe(3);
  });

  it("connects the new canner to the warehouse without overlapping fixtures", async () => {
    const state = prepared();
    const areas = state.franchises[0].unlockedAreas;
    const obstacles = storeObstaclesForAreas(areas);
    const fixture = obstacles.find((item) => item.id === "fixture:corn-canner")!;
    for (const other of obstacles.filter((item) => item !== fixture)) {
      expect(Math.abs(other.x - fixture.x) < other.halfX + fixture.halfX && Math.abs(other.z - fixture.z) < other.halfZ + fixture.halfZ, other.id).toBe(false);
    }
    await ensureStoreNavigation(91_224, areas);
    const point = productionFixtureForWorkstation("canner").operatorWorkPoint;
    const route = storePathfinder([0.9, -5.2], [...point]);
    expect(route.length).toBeGreaterThan(0);
    expect(Math.hypot(route.at(-1)![0] - point[0], route.at(-1)![1] - point[1])).toBeLessThan(0.3);
  });
  it("keeps fresh corn distinct and forbids ordering preserves before purchase or in legacy play", () => {
    const state = createCampaignGame();
    expect(canOrderProduct(state, "cannedCorn")).toBe(false);
    expect(canOrderProduct(createInitialGame(), "cannedCorn")).toBe(false);
    expect(campaignAvailableProducts(state.franchises[0].purchases!)).not.toContain("cannedCorn");
    expect(applyGameAction(state, { type: "ORDER", supplierId: "campo", productId: "cannedCorn", quantity: 3 }).ok).toBe(false);
    const opened = prepared();
    expect(campaignAvailableProducts(opened.franchises[0].purchases!)).toEqual(expect.arrayContaining(["corn", "cannedCorn"]));
  });
  it("orders, receives once, carries, stocks and reloads without changing fresh corn", () => {
    const initial = prepared();
    initial.franchises[0].warehouse.corn = 7;
    const order = applyGameAction(initial, { type: "ORDER", supplierId: "campo", productId: "cannedCorn", quantity: 3 });
    expect(order.ok).toBe(true);
    expect(order.state.balanceMinor).toBe(initial.balanceMinor - 480);
    expect(validateSaveTransition(initial, order.state, order.events)).toEqual({ ok: true });
    const restored = normalizeGameState(JSON.parse(JSON.stringify(order.state)));
    restored.franchises[0].open = true;
    restored.minuteOfDay = restored.pendingOrders[0].arrivesAtMinute;
    const delivered = advanceWorld(restored, 0);
    expect(delivered.state.franchises[0].warehouse.cannedCorn).toBe(3);
    expect(delivered.state.pendingOrders).toEqual([]);
    const repeated = advanceWorld(delivered.state, 0);
    expect(repeated.state.franchises[0].warehouse.cannedCorn).toBe(3);
    const picked = applyGameAction(repeated.state, { type: "PICKUP_WAREHOUSE", productId: "cannedCorn", quantity: 3 });
    const stocked = applyGameAction(picked.state, { type: "STOCK", productId: "cannedCorn", quantity: 3, source: "carry" });
    expect(picked.ok && stocked.ok).toBe(true);
    expect(validateSaveTransition(repeated.state, stocked.state, [...picked.events, ...stocked.events])).toEqual({ ok: true });
    const final = normalizeGameState(JSON.parse(JSON.stringify(stocked.state)));
    expect(final.franchises[0].shelves.cannedCorn).toBe(3);
    expect(final.franchises[0].warehouse.cannedCorn).toBe(0);
    expect(final.franchises[0].carry.items.cannedCorn ?? 0).toBe(0);
    expect(final.franchises[0].warehouse.corn).toBe(7);
    expect(shelfCapacityForTier(1, "cannedCorn", final.franchises[0].unlockedAreas)).toBe(40);
  });
  it("adds a non-overlapping fixture and keeps routes from warehouse and checkout open", async () => {
    const state = prepared();
    const areas = state.franchises[0].unlockedAreas;
    const obstacles = storeObstaclesForAreas(areas);
    const fixture = obstacles.find((item) => item.id === "fixture:retail-preserves-1")!;
    for (const other of obstacles.filter((item) => item !== fixture)) {
      const overlaps = Math.abs(other.x - fixture.x) < other.halfX + fixture.halfX && Math.abs(other.z - fixture.z) < other.halfZ + fixture.halfZ;
      expect(overlaps, other.id).toBe(false);
    }
    expect(await ensureStoreNavigation(91_223, areas)).toBe(true);
    const destination = retailServicePoint("cannedCorn");
    expect(isStoreNavigationPoint(destination, areas)).toBe(true);
    expect(isStoreNavigationPoint([fixture.x / STORE_LAYOUT_SCALE, fixture.z / STORE_LAYOUT_SCALE], areas)).toBe(false);
    for (const start of [[0.9, -5.2], [0, 6.25], [7, 2]] as [number, number][]) {
      const route = storePathfinder(start, destination);
      expect(route.length).toBeGreaterThan(0);
      expect(Math.hypot(route.at(-1)![0] - destination[0], route.at(-1)![1] - destination[1])).toBeLessThan(0.3);
    }
  });
});
