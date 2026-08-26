import { describe, expect, it } from "vitest";
import { advanceSimulation, applyGameAction, createInitialGame } from "./engine";

describe("motor económico", () => {
  it("mantiene una caja global al viajar entre franquicias", () => {
    const state = createInitialGame("ES");
    state.level = 10;
    state.balanceMinor = 2_000_000;
    const bought = applyGameAction(state, { type: "BUY_FRANCHISE", franchiseId: "estacion" });
    const balance = bought.state.balanceMinor;
    const travelled = applyGameAction(bought.state, { type: "TRAVEL", franchiseId: "estacion" });
    expect(travelled.ok).toBe(true);
    expect(travelled.state.balanceMinor).toBe(balance);
  });

  it("un reponedor delega el abastecimiento", () => {
    const state = createInitialGame("ES");
    state.level = 5;
    state.franchises[0].employees.push({ id: "e1", name: "Luna", role: "stocker", level: 1, salaryMinor: 3000, energy: 100, hat: "frog" });
    state.franchises[0].open = true;
    state.franchises[0].warehouse.apples = 3;
    const result = advanceSimulation(state, 10);
    expect(result.state.franchises[0].shelves.apples).toBeGreaterThan(0);
  });

  it("no permite gastar más caja de la disponible", () => {
    const state = createInitialGame("ES");
    state.balanceMinor = 0;
    expect(applyGameAction(state, { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 20 }).ok).toBe(false);
  });

  it("contabiliza impuestos solamente sobre beneficio positivo", () => {
    const state = createInitialGame("CO");
    state.franchises[0].revenueTodayMinor = state.balanceMinor * 3;
    const result = applyGameAction(state, { type: "CLOSE_DAY" });
    expect(result.state.finances.taxesMinor).toBeGreaterThan(0);
    expect(result.state.day).toBe(2);
  });

  it("escala toda la economía a la moneda del país", () => {
    const spain = createInitialGame("ES");
    const colombia = createInitialGame("CO");
    expect(colombia.balanceMinor).toBeGreaterThan(spain.balanceMinor * 1000);
    expect(colombia.franchises[1].purchaseCostMinor).toBeGreaterThan(spain.franchises[1].purchaseCostMinor * 1000);
    expect(colombia.missions[0].rewardMinor).toBeGreaterThan(spain.missions[0].rewardMinor * 1000);
  });
});
