import { describe, expect, it } from "vitest";
import { applyGameAction, createCampaignGame, normalizeGameState } from "../engine";
import { CAMPAIGN_LEVEL_COUNT, LEVEL_CATALOG, campaignNextStep, levelEntry, purchasePrerequisites, taskProduct } from "./LevelCatalog";
import { CAMPAIGN_PRODUCT_REQUIREMENTS, OPENING_PURCHASES, OPENING_PURCHASE_LEVEL } from "./MartCampaign";
import { CAMPAIGN_TASKS, PURCHASE_TASK_REQUIREMENTS, type CampaignTaskId } from "./CampaignTasks";
import { CAMPAIGN_CONTRACTS } from "./CampaignContracts";
import { CASHIER_UNLOCK_LEVELS, campaignLevel } from "./CampaignLevels";
import { PRODUCT_IDS } from "../economy/ProductRegistry";

describe("level catalog", () => {
  it("has exactly thirty levels, one pattern and one exam each, in order", () => {
    expect(LEVEL_CATALOG).toHaveLength(CAMPAIGN_LEVEL_COUNT);
    LEVEL_CATALOG.forEach((entry, index) => {
      expect(entry.level).toBe(index + 1);
      expect(entry.teaches).toBeTruthy();
      expect(entry.exam).toBeTruthy();
    });
    expect(levelEntry(0).level).toBe(1);
    expect(levelEntry(99).level).toBe(30);
  });

  it("follows the authored purchase spine: every prerequisite sits at a lower level", () => {
    OPENING_PURCHASES.forEach((purchase, index) => {
      for (const required of purchase.requires) {
        const requiredIndex = OPENING_PURCHASES.findIndex((item) => item.id === required);
        expect(requiredIndex, `${purchase.id} requires ${required}`).toBeGreaterThanOrEqual(0);
        expect(requiredIndex, `${purchase.id} requires ${required}`).toBeLessThan(index);
      }
      expect(LEVEL_CATALOG[index + 1].grantedBy).toBe(purchase.id);
      expect(OPENING_PURCHASE_LEVEL.get(purchase.id)).toBe(index + 2);
    });
  });

  it("opens every product exactly once along the spine and asks for nothing before it exists", () => {
    const opened = LEVEL_CATALOG.flatMap((entry) => entry.unlocks.products);
    expect([...opened].sort()).toEqual([...PRODUCT_IDS].sort());
    // A personal task gating a purchase must work with a product whose chain
    // is already among that purchase's prerequisites: otherwise the level can
    // never be closed and no crash would say so (§7.1 parameter consistency).
    for (const [purchaseId, tasks] of Object.entries(PURCHASE_TASK_REQUIREMENTS) as [keyof typeof PURCHASE_TASK_REQUIREMENTS, readonly CampaignTaskId[]][]) {
      const prerequisites = purchasePrerequisites(purchaseId);
      for (const task of tasks) {
        for (const requirement of CAMPAIGN_PRODUCT_REQUIREMENTS[taskProduct(task)]) {
          expect(prerequisites, `${purchaseId} ← ${task}`).toContain(requirement);
        }
      }
    }
    // Every contract's products are unlocked by level 28 at the latest, and
    // every personal task's product exists in the catalog.
    for (const contract of CAMPAIGN_CONTRACTS) for (const product of contract.products) expect(PRODUCT_IDS).toContain(product);
    for (const id of Object.keys(CAMPAIGN_TASKS) as CampaignTaskId[]) expect(PRODUCT_IDS).toContain(taskProduct(id));
  });

  it("hands over the three cashiers at the authored levels and the staff a purchase brings", () => {
    for (const level of CASHIER_UNLOCK_LEVELS) expect(levelEntry(level).unlocks.cashierSlots).toBe(1);
    expect(LEVEL_CATALOG.reduce((sum, entry) => sum + entry.unlocks.cashierSlots, 0)).toBe(CASHIER_UNLOCK_LEVELS.length);
    const staff = LEVEL_CATALOG.flatMap((entry) => entry.unlocks.staff);
    expect(staff.filter((role) => role === "farmer")).toHaveLength(8);
    expect(staff.filter((role) => role === "feeder")).toHaveLength(3);
    expect(staff.filter((role) => role === "operator")).toHaveLength(5);
    expect(staff.filter((role) => role === "cashier")).toHaveLength(3);
  });

  it("closes level 28 with the personal tasks no purchase asked for, then contracts, then the next store", () => {
    expect(levelEntry(28).exam).toMatchObject({ kind: "tasks" });
    const gated = new Set(Object.values(PURCHASE_TASK_REQUIREMENTS).flat());
    const remaining = (levelEntry(28).exam as { tasks: readonly CampaignTaskId[] }).tasks;
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.every((task) => !gated.has(task))).toBe(true);
    expect(levelEntry(29).exam).toEqual({ kind: "contracts" });
    expect(levelEntry(30).exam).toEqual({ kind: "expansion" });
  });
});

describe("next step for the owner", () => {
  it("points at the first purchase, then its money, then the register, then the shelf", () => {
    const state = createCampaignGame();
    const franchise = state.franchises[0];
    franchise.owned = true;
    expect(campaignNextStep(state)).toMatchObject({ level: 1, goal: "Nivel 2: Primer granjero-reponedor" });
    expect(campaignNextStep(state)?.step).toMatch(/^Surte tomates y vende/);
    franchise.shelves.tomatoes = 5;
    expect(campaignNextStep(state)?.step).toMatch(/^Vende para reunir/);
    franchise.registerCashMinor = [500, 0, 0];
    expect(campaignNextStep(state)?.step).toMatch(/^Recoge/);
    state.balanceMinor = 2_000;
    expect(campaignNextStep(state)?.step).toMatch(/^Paga/);
    expect(campaignNextStep(state)?.purchaseId).toBe("farmer-1");
  });

  it("asks for the pending personal task before the purchase it gates", () => {
    let state = createCampaignGame();
    state.balanceMinor = 10_000_000;
    for (const purchaseId of ["farmer-1", "egg-display-1", "chicken-1", "player-2", "tomato-2", "farmer-2"] as const) {
      const result = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId, amountMinor: 10_000_000 });
      expect(result.ok, purchaseId).toBe(true);
      state = result.state;
    }
    expect(campaignLevel(state.franchises[0])).toBe(7);
    const next = campaignNextStep(state);
    expect(next?.goal).toBe("Nivel 8: Ampliación: cereales y segunda granja");
    expect(next?.step).toMatch(/^Cosecha tú 8 tomates \(0\/8\)/);
  });

  it("walks levels 28, 29 and 30 to their own exams", () => {
    let state = createCampaignGame();
    state.balanceMinor = 10_000_000;
    state.franchises[0].purchases!.personalProgress = Object.fromEntries(Object.entries(CAMPAIGN_TASKS).map(([id, task]) => [id, task.target]));
    for (const purchase of OPENING_PURCHASES) state = applyGameAction(state, { type: "CONTRIBUTE_PURCHASE", purchaseId: purchase.id, amountMinor: 10_000_000 }).state;
    state = normalizeGameState(JSON.parse(JSON.stringify(state)));
    expect(campaignLevel(state.franchises[0])).toBe(29);
    expect(campaignNextStep(state)).toMatchObject({ level: 29, goal: "Nivel 30: encargos personales" });
    expect(campaignNextStep(state)?.step).toMatch(/^Reúne en tu cesta/);
    state.franchises[0].purchases!.personalProgress = {};
    expect(campaignNextStep(state)).toMatchObject({ level: 28, goal: "Nivel 29: maestría personal" });
    state.franchises[0].purchases!.personalProgress = Object.fromEntries(Object.entries(CAMPAIGN_TASKS).map(([id, task]) => [id, task.target]));
    state.franchises[0].purchases!.completedContracts = CAMPAIGN_CONTRACTS.filter((contract) => contract.location === "barrio").map((contract) => contract.id);
    expect(campaignLevel(state.franchises[0])).toBe(30);
    expect(campaignNextStep(state)).toMatchObject({ level: 30, goal: "Abre Market Estación" });
  });

  it("returns nothing for a legacy save without the purchase campaign", () => {
    const state = createCampaignGame();
    delete state.franchises[0].purchases;
    expect(campaignNextStep(state)).toBeNull();
  });
});
