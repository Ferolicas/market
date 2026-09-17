import { beforeAll, describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, createCampaignGame, shelfCapacityForTier, storeSupplyPlan } from "../engine";
import { PRODUCT_IDS, type ProductId } from "../economy/ProductRegistry";
import { PRODUCT_CONFIG } from "../economy/products";
import { OPENING_PURCHASES } from "../progression/MartCampaign";
import { CAMPAIGN_TASK_IDS, campaignTaskTarget } from "../progression/CampaignTasks";
import { animalProduction } from "../stations/FedAnimal";
import type { GameState } from "../types";

let complete: GameState;
beforeAll(() => {
  complete = createCampaignGame();
  complete.balanceMinor = 100_000_000;
  complete.franchises[0].purchases!.personalProgress = Object.fromEntries(CAMPAIGN_TASK_IDS.map(id => [id, campaignTaskTarget(id)]));
  for (const purchase of OPENING_PURCHASES) {
    const result = applyGameAction(complete, { type: "CONTRIBUTE_PURCHASE", purchaseId: purchase.id, amountMinor: 100_000_000 });
    expect(result.ok, purchase.id).toBe(true);
    complete = result.state;
  }
});
function fixture(product: ProductId, storeIndex = 0) {
  const state = structuredClone(complete);
  const template = state.franchises[storeIndex];
  const shop = structuredClone(state.franchises[0]);
  Object.assign(shop, { id: template.id, name: template.name, city: template.city, unlockLevel: template.unlockLevel, purchaseCostMinor: template.purchaseCostMinor, owned: true, open: false });
  state.franchises.forEach(f => { f.owned = false; });
  state.franchises[storeIndex] = shop;
  state.currentFranchiseId = shop.id;
  shop.supplyFocus = undefined;
  for (const id of PRODUCT_IDS) {
    shop.warehouse[id] = id === product ? 2 : 300;
    shop.shelves[id] = shelfCapacityForTier(1, id, shop.unlockedAreas);
  }
  for (const employee of shop.employees) {
    employee.level = 5;
    if (employee.runtime) Object.assign(employee.runtime, { state: "IDLE", stateSince: -10_000, assignedProduct: null, assignedStationId: null, path: [], pathIndex: 0, carry: { capacity: 10, items: {} } });
  }
  return state;
}
const cases = [0, 1, 2, 3, 4, 5].flatMap(store => PRODUCT_IDS.map(product => ({ store, product })));

describe("every catalog product in every store", () => {
  it.each(cases)("store $store: rebuilds $product to the largest warehouse stock", ({ store, product }) => {
    const state = fixture(product, store), shop = state.franchises[store];
    expect(storeSupplyPlan(shop)[0]).toBe(product);
    expect(shop.supplyFocus).toEqual({ productId: product, target: 300 });
    shop.warehouse[product] = 250;
    expect(storeSupplyPlan(shop)[0]).toBe(product);
    shop.warehouse[product] = 300;
    const nextProduct = PRODUCT_IDS.find(id => id !== product)!;
    shop.warehouse[nextProduct] = 1;
    expect(storeSupplyPlan(shop)[0]).toBe(nextProduct);
  });

  it.each(cases)("store $store: actually replenishes $product without producing unrelated products", ({ store, product }) => {
    let state = fixture(product, store);
    const chain = storeSupplyPlan(state.franchises[store]);
    for (let second = 0; second < 2_400 && state.franchises[store].warehouse[product] < 300; second++) {
      state = advanceWorld(state, 1_000, (_start, end) => [end]).state;
    }
    expect(state.franchises[store].warehouse[product], `${product}: ${JSON.stringify(state.franchises[store].warehouse)}`).toBeGreaterThanOrEqual(300);
    for (const id of PRODUCT_IDS.filter(id => !chain.includes(id))) expect(state.franchises[store].warehouse[id], id).toBe(300);
  });

  it.each(PRODUCT_IDS)("restocks ready %s while another reserve is being rebuilt", product => {
    const other = PRODUCT_IDS.find(id => id !== product && !PRODUCT_CONFIG[id]?.cycleMs)!;
    let state = fixture(other);
    const shop = state.franchises[0];
    storeSupplyPlan(shop);
    shop.warehouse[product] = 0;
    shop.shelves[product] = 0;
    const source = shop.productionMachines.find(m => m.productId === product)
      ?? shop.crops.find(c => c.productId === product)!;
    if ("output" in source) Object.assign(source, { output: 8, status: "OUTPUT_READY" });
    else Object.assign(source, { available: 8, status: "READY" });
    state = advanceWorld(state, 500).state;
    expect(state.franchises[0].employees.some(e => e.runtime?.assignedStationId === source.id && e.runtime?.assignedProduct === product)).toBe(true);
    for (let seconds = 0; seconds < 180 && state.franchises[0].shelves[product] === 0; seconds++) state = advanceWorld(state, 1_000, (_start, end) => [end]).state;
    expect(state.franchises[0].shelves[product]).toBeGreaterThan(0);
  });

  it.each(PRODUCT_IDS)("interrupts a stocked reserve for totally missing %s even before the reserve reaches its own shelf", product => {
    const other = PRODUCT_IDS.find(id => id !== product)!;
    const state = fixture(other), shop = state.franchises[0];
    shop.shelves[other] = 0;
    storeSupplyPlan(shop);
    shop.warehouse[product] = 0; shop.shelves[product] = 0;
    expect(storeSupplyPlan(shop)[0]).toBe(product);
  });

  it.each(["eggs", "milk", "flour", "bread", "cheese", "juice", "cannedCorn"] as const)("protects the scarce retail ingredient of surplus %s", product => {
    const state = fixture(product), shop = state.franchises[0];
    const policy = animalProduction(product, 1);
    const ingredient = policy?.input ?? Object.keys(PRODUCT_CONFIG[product]!.recipe!)[0] as ProductId;
    shop.warehouse[product] = 300; shop.warehouse[ingredient] = 2;
    expect(storeSupplyPlan(shop)[0]).toBe(ingredient);
    const next = advanceWorld(state, 500).state.franchises[0];
    expect(next.employees.some(e => e.runtime?.assignedStationId === shop.productionMachines.find(m => m.productId === product)!.id && e.runtime?.assignedProduct === ingredient)).toBe(false);
  });
});
