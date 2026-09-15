import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, createCampaignGame, normalizeGameState } from "../engine";
import { OPENING_PURCHASES } from "../progression/MartCampaign";
import { campaignEmployeeLimit } from "../progression/CampaignLevels";
import { chickenFeedStatus } from "./StationSystem";

function campaignThrough(id: string) {
  let state = createCampaignGame();
  state.balanceMinor = 100_000_000;
  state.franchises[0].purchases!.personalProgress = Object.fromEntries(
    ["player:harvest:tomatoes", "player:stock:tomatoes", "player:feed:chicken", "player:stock:eggs",
      "player:harvest:wheat", "player:collect:flour", "player:stock:bread"].map((task) => [task, 99]),
  );
  for (const purchase of OPENING_PURCHASES) {
    const result = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId: purchase.id, amountMinor: 10_000_000 });
    expect(result.ok, purchase.id).toBe(true);
    state = result.state;
    if (purchase.id === id) break;
  }
  return normalizeGameState(JSON.parse(JSON.stringify(state)));
}

describe("animal feeder", () => {
  it("opens one desk with the cow and fills it with the purchase", () => {
    const beforeCow = campaignThrough("dairy-display-1");
    expect(campaignEmployeeLimit(beforeCow.franchises[0], "feeder")).toBe(0);
    expect(beforeCow.franchises[0].employees.some((employee) => employee.role === "feeder")).toBe(false);

    const withCow = campaignThrough("cow-1");
    expect(campaignEmployeeLimit(withCow.franchises[0], "feeder")).toBe(1);
    expect(withCow.franchises[0].employees.filter((employee) => employee.role === "feeder")).toHaveLength(1);
  });

  it("carries feed from the warehouse into the troughs and nothing else", () => {
    let state = campaignThrough("cow-1");
    const franchise = state.franchises[0];
    // Only the feeder is on shift, so the movement under test is unambiguous.
    franchise.employees = franchise.employees.filter((employee) => employee.role === "feeder");
    franchise.warehouse.tomatoes = 12;
    franchise.warehouse.wheat = 12;
    const trough = () => {
      const current = state.franchises[0];
      return current.productionMachines
        .filter((machine) => machine.id.startsWith("chicken-coop") || machine.id === "cow-station-1")
        .reduce((total, machine) => total + chickenFeedStatus(machine).occupied, 0);
    };
    expect(trough()).toBe(0);
    for (let second = 0; second < 120 && trough() === 0; second++) state = advanceWorld(state, 1_000).state;
    expect(trough()).toBeGreaterThan(0);
    const feeder = state.franchises[0].employees[0];
    expect(feeder.role).toBe("feeder");
    // The feeder never restocks shelves: that is the granjero-reponedor's job.
    expect(Object.values(state.franchises[0].shelves).every((quantity) => quantity === 0)).toBe(true);
  });
});
