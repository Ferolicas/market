import { describe, expect, it } from "vitest";
import { PRODUCTS, SUPPLIERS } from "../catalog";
import { advanceWorld, applyGameAction, createInitialGame, normalizeGameState, unlockedCustomerProducts } from "../engine";
import { PRODUCT_IDS } from "./ProductRegistry";
import { PRODUCT_SUPPLY } from "./ProductSupply";
import { PRODUCT_CONFIG } from "./products";
import { CAMPAIGN_PRODUCT_REQUIREMENTS, campaignAvailableProducts, collectOpeningRegister, createOpeningCampaign, creditOpeningRegister, fundOpeningPurchase, OPENING_PURCHASES } from "../progression/MartCampaign";

describe("complete existing catalog coverage", () => {
  it("retains every registered product in supply, retail demand and the purchase campaign", () => {
    expect(Object.keys(PRODUCT_SUPPLY).sort()).toEqual([...PRODUCT_IDS].sort());
    expect(unlockedCustomerProducts(30).sort()).toEqual(PRODUCT_IDS.filter((id) => PRODUCT_SUPPLY[id].legacyLevel <= 30).sort());
    let campaign = collectOpeningRegister(creditOpeningRegister(createOpeningCampaign(), 10_000_000));
    for (const purchase of OPENING_PURCHASES) campaign = fundOpeningPurchase(campaign, purchase.id, "ES", 10_000_000);
    expect(campaignAvailableProducts(campaign).sort()).toEqual([...PRODUCT_IDS].sort());
  });

  it.each(PRODUCT_IDS)("%s has an accessible source before customer demand", (product) => {
    const route = PRODUCT_SUPPLY[product];
    const initial = createInitialGame();
    initial.level = route.legacyLevel;
    const state = normalizeGameState(initial);
    if (route.kind === "supplier") {
      const supplier = SUPPLIERS.find((candidate) => candidate.id === route.supplierId)!;
      expect(supplier.unlockLevel).toBeLessThanOrEqual(route.legacyLevel);
      expect(PRODUCTS[product].supplier).toBe(supplier.id);
    } else {
      const station = route.kind === "crop" ? state.franchises[0].crops.find((crop) => crop.id === route.stationId)
        : state.franchises[0].productionMachines.find((machine) => machine.id === route.stationId);
      expect(station?.productId).toBe(product);
      expect(station?.status).not.toBe("LOCKED");
    }
    expect(unlockedCustomerProducts(route.legacyLevel)).toContain(product);
    if (route.legacyLevel > 1) expect(unlockedCustomerProducts(route.legacyLevel - 1)).not.toContain(product);
  });

  it("never offers a transformed product before the ingredient purchase paths", () => {
    for (const product of PRODUCT_IDS) {
      const ancestors = new Set<string>();
      function visit(id: string) {
        if (ancestors.has(id)) return;
        ancestors.add(id);
        for (const dependency of OPENING_PURCHASES.find((purchase) => purchase.id === id)!.requires) visit(dependency);
      }
      CAMPAIGN_PRODUCT_REQUIREMENTS[product].forEach(visit);
      for (const ingredient of Object.keys(PRODUCT_CONFIG[product]?.recipe ?? {}) as typeof PRODUCT_IDS[number][]) {
        for (const required of CAMPAIGN_PRODUCT_REQUIREMENTS[ingredient]) expect(ancestors.has(required), `${product} needs ${ingredient}`).toBe(true);
      }
    }
  });

  it("orders, receives, carries and stocks coffee once across a reload", () => {
    const initial = createInitialGame();
    initial.level = 9;
    const ordered = applyGameAction(normalizeGameState(initial), { type: "ORDER", supplierId: "andes", productId: "coffee", quantity: 3 });
    expect(ordered.ok).toBe(true);
    const restored = normalizeGameState(JSON.parse(JSON.stringify(ordered.state)));
    restored.franchises[0].open = true;
    restored.minuteOfDay = restored.pendingOrders[0].arrivesAtMinute;
    const delivered = advanceWorld(restored, 0);
    expect(delivered.state.franchises[0].warehouse.coffee).toBe(3);
    expect(delivered.state.pendingOrders).toEqual([]);
    const repeated = advanceWorld(delivered.state, 0);
    expect(repeated.state.franchises[0].warehouse.coffee).toBe(3);
    const picked = applyGameAction(repeated.state, { type: "PICKUP_WAREHOUSE", productId: "coffee", quantity: 3 });
    expect(picked.ok).toBe(true);
    const stocked = applyGameAction(picked.state, { type: "STOCK", productId: "coffee", quantity: 3, source: "carry" });
    expect(stocked.ok).toBe(true);
    expect(stocked.state.franchises[0].shelves.coffee).toBe(3);
    expect(stocked.state.franchises[0].carry.items.coffee ?? 0).toBe(0);
  });

  it.each(PRODUCT_IDS.filter((id) => PRODUCT_SUPPLY[id].kind !== "supplier"))("produces or harvests %s and transfers it to its existing shelf", (product) => {
    const initial = createInitialGame();
    initial.level = 30;
    let state = normalizeGameState(initial);
    const route = PRODUCT_SUPPLY[product];
    const initialShelf = state.franchises[0].shelves[product];
    if (route.kind === "supplier") throw new Error("Supplier products use the order/delivery acceptance path");
    if (route.kind === "crop") {
      const crop = state.franchises[0].crops.find((candidate) => candidate.id === route.stationId)!;
      for (let remaining = crop.readyAt - state.simulationTimeMs; remaining > 0; remaining -= 1_000) {
        state = advanceWorld(state, Math.min(1_000, remaining)).state;
      }
      const harvest = applyGameAction(state, { type: "HARVEST", cropId: route.stationId, quantity: 1 });
      expect(harvest.ok).toBe(true);
      state = harvest.state;
    } else {
      state.franchises[0].carry.items = { ...PRODUCT_CONFIG[product]!.recipe };
      const load = applyGameAction(state, { type: "OPERATE_MACHINE", machineId: route.stationId });
      expect(load.ok).toBe(true);
      state = normalizeGameState(JSON.parse(JSON.stringify(load.state)));
      const machine = state.franchises[0].productionMachines.find((candidate) => candidate.id === route.stationId)!;
      for (let remaining = machine.completesAt! - state.simulationTimeMs; remaining > 0; remaining -= 1_000) {
        state = advanceWorld(state, Math.min(1_000, remaining)).state;
      }
      const collect = applyGameAction(state, { type: "OPERATE_MACHINE", machineId: route.stationId });
      expect(collect.ok).toBe(true);
      state = collect.state;
    }
    const stock = applyGameAction(state, { type: "STOCK", productId: product, quantity: 1, source: "carry" });
    expect(stock.ok).toBe(true);
    expect(stock.state.franchises[0].shelves[product]).toBe(initialShelf + 1);
    expect(stock.state.franchises[0].carry.items[product] ?? 0).toBe(0);
  });
});
