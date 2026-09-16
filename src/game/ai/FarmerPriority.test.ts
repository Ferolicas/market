import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, createCampaignGame, normalizeGameState } from "../engine";
import { CAMPAIGN_TASK_IDS, campaignTaskTarget } from "../progression/CampaignTasks";
import { retailShelfCapacityForTier } from "../stations/retail-layout";

/** Two farmers, three tomato beds and one wheat bed, everything ripe. */
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
    expect(assigned).toHaveLength(2);
    expect(assigned).toContain("crop-wheat-1");
    // The wheat bed is taken; the second farmer levels the next scarcest crop.
    expect(assigned.filter((id) => id === "crop-wheat-1")).toHaveLength(1);
    expect(assigned.some((id) => id?.startsWith("crop-tomato"))).toBe(true);
  });

  it("sends the first farmer to tomatoes when wheat is the surplus", () => {
    const state = farmWithWheat();
    state.franchises[0].warehouse.tomatoes = 5;
    state.franchises[0].warehouse.wheat = 90;
    const assigned = assignments(advanceWorld(state, 400).state);
    expect(assigned.every((id) => id?.startsWith("crop-tomato"))).toBe(true);
  });

  it("counts what a farmer already carries, so two do not chase the same shortage", () => {
    const state = farmWithWheat();
    state.franchises[0].warehouse.tomatoes = 30;
    state.franchises[0].warehouse.wheat = 26;
    // One farmer is already bringing back a basket of wheat.
    const [first, second] = state.franchises[0].employees.filter((employee) => employee.role === "farmer");
    first.runtime!.carry.items = { wheat: 8 };
    first.runtime!.state = "NAVIGATE_DROPOFF";
    first.runtime!.assignedStationId = "crop-wheat-1";
    const ticked = advanceWorld(state, 400).state;
    expect(ticked.franchises[0].employees.find((employee) => employee.id === second.id)!.runtime!.assignedStationId).toMatch(/^crop-tomato/);
  });
});
