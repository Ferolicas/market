import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, createCampaignGame, normalizeGameState } from "../engine";
import { CAMPAIGN_TASK_IDS, campaignTaskTarget } from "../progression/CampaignTasks";
import { retailShelfCapacityForTier } from "../stations/retail-layout";

/** Four farmers (two desks, the second farm and the wheat bed each bring
 * one), three tomato beds and one wheat bed, everything ripe. */
function farmWithWheat() {
  let state = createCampaignGame();
  state.balanceMinor = 100_000_000;
  state.franchises[0].purchases!.personalProgress = Object.fromEntries(CAMPAIGN_TASK_IDS.map((id) => [id, campaignTaskTarget(id)]));
  for (const id of ["farmer-1", "egg-display-1", "chicken-1", "tomato-2", "farmer-2", "expansion-1", "wheat-1", "tomato-3"] as const) {
    const result = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId: id, amountMinor: 10_000_000 });
    expect(result.ok, id).toBe(true);
    state = result.state;
  }
  state = normalizeGameState(JSON.parse(JSON.stringify(state)));
  const franchise = state.franchises[0];
  for (const crop of franchise.crops) {
    if (crop.status === "LOCKED") continue;
    Object.assign(crop, { status: "READY", available: 8 });
  }
  franchise.warehouse.eggs = 300;
  // Every shelf is full, so restocking never pre-empts the harvest choice.
  for (const productId of ["tomatoes", "wheat", "eggs"] as const) {
    franchise.shelves[productId] = retailShelfCapacityForTier(franchise.stationTiers["shelves-1"] ?? 1, productId, franchise.unlockedAreas);
  }
  for (const employee of franchise.employees) employee.runtime!.stateSince = -10_000;
  return state;
}

function assignments(state: ReturnType<typeof farmWithWheat>) {
  return state.franchises[0].employees
    .filter((employee) => employee.role === "farmer")
    .map((employee) => employee.runtime!.assignedStationId);
}

describe("farmers harvest the scarcest product first", () => {
  it("sends the first farmer to wheat when tomatoes overflow the warehouse", () => {
    const state = farmWithWheat();
    state.franchises[0].warehouse.tomatoes = 120;
    state.franchises[0].warehouse.wheat = 20;
    const ticked = advanceWorld(state, 400).state;
    const assigned = assignments(ticked);
    expect(assigned).toHaveLength(4);
    // All head for the single wheat bed: one harvests it, the others wait
    // beside it for the next batch instead of piling up more tomatoes.
    expect(assigned.every((id) => id === "crop-wheat-1")).toBe(true);
  });

  it("restocks any incomplete shelf before building warehouse reserves", () => {
    const state = farmWithWheat();
    state.franchises[0].warehouse.tomatoes = 100;
    state.franchises[0].warehouse.wheat = 100;
    const capacity = state.franchises[0].shelves.tomatoes;
    state.franchises[0].shelves.tomatoes = Math.ceil(capacity * 0.5);
    let assigned = assignments(advanceWorld(state, 400).state);
    expect(assigned.some((id) => id === "stockroom")).toBe(true);


    state.franchises[0].shelves.tomatoes = Math.floor(capacity * 0.2);
    for (const employee of state.franchises[0].employees) employee.runtime!.stateSince = -10_000;
    assigned = assignments(advanceWorld(state, 400).state);
    expect(assigned.some((id) => id === "stockroom")).toBe(true);
  });

  it("waits for the scarce bed to ripen rather than harvesting a surplus", () => {
    const state = farmWithWheat();
    state.franchises[0].warehouse.tomatoes = 496;
    state.franchises[0].warehouse.wheat = 0;
    const wheat = state.franchises[0].crops.find((crop) => crop.id === "crop-wheat-1")!;
    Object.assign(wheat, { status: "GROWING", available: 0, plantedAt: state.simulationTimeMs, readyAt: state.simulationTimeMs + 6_000 });
    let ticked = advanceWorld(state, 400).state;
    // Nobody touches the tomato surplus: everyone walks to the wheat bed and
    // waits there for it to ripen.
    expect(assignments(ticked).every((id) => id === "crop-wheat-1")).toBe(true);
    for (let index = 0; index < 20; index += 1) ticked = advanceWorld(ticked, 400).state;
    expect(assignments(ticked).some((id) => id?.startsWith("crop-tomato"))).toBe(false);
    const wheatOnHand = ticked.franchises[0].warehouse.wheat + ticked.franchises[0].employees.reduce((sum, employee) => sum + (employee.runtime!.carry.items.wheat ?? 0), 0);
    expect(wheatOnHand).toBeGreaterThan(0);
  });

  it("sends the first farmer to tomatoes when wheat is the surplus", () => {
    const state = farmWithWheat();
    state.franchises[0].warehouse.tomatoes = 5;
    state.franchises[0].warehouse.wheat = 90;
    const assigned = assignments(advanceWorld(state, 400).state);
    expect(assigned.every((id) => id?.startsWith("crop-tomato"))).toBe(true);
  });

  it("compares warehouse quantities when choosing the next reserve to rebuild", () => {
    const state = farmWithWheat();
    // Shelves hold 30 tomatoes and 12 wheat. Without the basket in flight,
    // wheat (38) would be the scarcer crop and the second farmer would wait.
    state.franchises[0].warehouse.tomatoes = 10;
    state.franchises[0].warehouse.wheat = 26;
    // One farmer is already bringing back a basket of wheat: 46 on hand.
    const [first, second] = state.franchises[0].employees.filter((employee) => employee.role === "farmer");
    first.runtime!.carry.items = { wheat: 8 };
    first.runtime!.state = "NAVIGATE_DROPOFF";
    first.runtime!.assignedStationId = "crop-wheat-1";
    const ticked = advanceWorld(state, 400).state;
    expect(ticked.franchises[0].employees.find((employee) => employee.id === second.id)!.runtime!.assignedStationId).toMatch(/^crop-tomato/);
  });
});
