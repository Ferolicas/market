import { describe, expect, it } from "vitest";
import { createInitialGame } from "../engine";
import type { GameState } from "../types";
import { averageShelfAvailability, levelObjectiveSatisfied, levelObjectiveTasks, unlockedCustomerProducts } from "./objectives";

describe("level objectives", () => {
  it("exposes the three exact level-one requirements and their live progress", () => {
    const state = createInitialGame();
    state.progression.counters = { "harvest:tomatoes": 2, "stock:tomatoes": 3, customers: 1 };

    expect(levelObjectiveTasks(1, state)).toEqual([
      { id: "harvest:tomatoes", label: "Cosecha 3 tomates", progress: 2, target: 3, unit: "count" },
      { id: "stock:tomatoes", label: "Surte 3 tomates", progress: 3, target: 3, unit: "count" },
      { id: "customers", label: "Atiende 1 cliente", progress: 1, target: 1, unit: "count" },
    ]);
    expect(levelObjectiveSatisfied(1, state)).toBe(false);

    state.progression.counters["harvest:tomatoes"] = 3;
    expect(levelObjectiveSatisfied(1, state)).toBe(true);
  });

  it("keeps all 30 level gates aligned with the authoritative counters", () => {
    const scenarios: [number, (state: GameState) => void][] = [
      [2, (state) => { state.progression.completedLevels.push(1); }],
      [3, withCounter("customers", 4)],
      [4, withCounter("stock:all", 12)],
      [5, withCounter("harvest:wheat", 6)],
      [6, withCounter("sales:bread", 4)],
      [7, withCounter("customers", 12)],
      [8, withCounter("sales:eggs", 8)],
      [9, (state) => { for (const productId of unlockedCustomerProducts(10)) state.franchises[0].shelves[productId] = 1_000; }],
      [10, withCounter("sales:units", 20)],
      [11, withCounter("harvest:corn", 20)],
      [12, withCounter("distance:player", 500)],
      [13, withCounter("sales:milk", 12)],
      [14, withCounter("customers", 30)],
      [15, withCounter("transport:all", 40)],
      [16, withCounter("production:cheese", 10)],
      [17, withCounter("queue:under30", 1)],
      [18, withCounter("deliveries", 5)],
      [19, withCounter("orders", 8)],
      [20, withCounter("customers", 50)],
      [21, withCounter("sales:juice", 15)],
      [22, withCounter("harvest:all", 60)],
      [23, (state) => { state.franchises[0].rating = 4.25; }],
      [24, withCounter("stock:all", 100)],
      [25, withCounter("lists:five", 1)],
      [26, withCounter("production:all", 50)],
      [27, withCounter("sales:units", 150)],
      [28, (state) => { for (const stationId of Object.keys(state.franchises[0].stationTiers)) state.franchises[0].stationTiers[stationId] = 3; }],
      [29, withCounter("availability:sales", 50)],
    ];

    for (const [level, complete] of scenarios) {
      const state = createInitialGame();
      expect(levelObjectiveTasks(level, state)).toHaveLength(1);
      expect(levelObjectiveSatisfied(level, state), `level ${level} should start incomplete`).toBe(false);
      complete(state);
      expect(levelObjectiveSatisfied(level, state), `level ${level} should use its documented requirement`).toBe(true);
    }

    expect(levelObjectiveTasks(30, createInitialGame())).toEqual([
      { id: "level:max", label: "Nivel máximo alcanzado", progress: 1, target: 1, unit: "count" },
    ]);
    expect(levelObjectiveSatisfied(30, createInitialGame())).toBe(true);
    expect(levelObjectiveSatisfied(31, createInitialGame())).toBe(false);
  });

  it("uses the same product unlocks and tier-aware shelf capacity as the simulation", () => {
    const state = createInitialGame();
    const franchise = state.franchises[0];

    expect(unlockedCustomerProducts(1)).toEqual(["tomatoes"]);
    expect(unlockedCustomerProducts(10)).toEqual(["tomatoes", "apples", "bread", "eggs", "coffee"]);
    expect(averageShelfAvailability(franchise)).toBeCloseTo((8 / 12 + 6 / 10) / 5);

    franchise.stationTiers["shelves-1"] = 2;
    expect(averageShelfAvailability(franchise)).toBeCloseTo((8 / 15 + 6 / 13) / 5);
  });
});

function withCounter(counterId: string, target: number) {
  return (state: GameState) => {
    state.progression.counters[counterId] = target;
  };
}
