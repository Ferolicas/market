import { describe, expect, it } from "vitest";
import { stationTierModifiers } from "./levels";
import { employeeCarryCapacity, employeeTrainingMultiplier } from "./EmployeeStats";
import { playerMotionForTier } from "../player/PlayerController";
import { cropGrowthDurationMs, cropHarvestYield, createMachine, machineCycleMs } from "../stations/StationSystem";
import { animalProduction } from "../stations/FedAnimal";
import { createCampaignGame, normalizeGameState } from "../engine";

describe("four shared upgrades", () => {
  it.each([1, 2, 3, 4, 5])("uses +25 percent base speed and production at tier %s", tier => {
    const multiplier = 1 + (tier - 1) * .25;
    expect(stationTierModifiers(tier)).toEqual({ speed: multiplier, capacity: multiplier, value: 1 });
    expect(employeeTrainingMultiplier(tier)).toBe(multiplier);
    expect(employeeCarryCapacity(tier)).toBe([3, 4, 6, 8, 10][tier - 1]);
    for (const campaign of [false, true]) expect(playerMotionForTier(tier, campaign).walkSpeed / playerMotionForTier(1, campaign).walkSpeed).toBeCloseTo(multiplier);
    expect(machineCycleMs(createMachine("flour-mill-1", "flour", tier))).toBe(4_000 / multiplier);
    expect(cropHarvestYield("tomatoes", tier, 8)).toBe(8 * multiplier);
    expect(cropGrowthDurationMs("tomatoes", 1, 30) / cropGrowthDurationMs("tomatoes", tier, 30)).toBeCloseTo(multiplier, 2);
    expect(animalProduction("eggs", tier)!.capacity).toBe(4 * multiplier);
    expect(animalProduction("milk", tier)!.cycleMs).toBe(Math.round(6_000 / multiplier));
  });
  it("repairs previously bought player upgrades without discarding an older large basket", () => {
    const state = createCampaignGame();
    state.franchises[0].playerSpeedTier = 6;
    state.franchises[0].carry.capacity = 8;
    expect(normalizeGameState(state).franchises[0].carry.capacity).toBe(10);
    state.franchises[0].carry.capacity = 20;
    expect(normalizeGameState(state).franchises[0].carry.capacity).toBe(20);
  });
});
