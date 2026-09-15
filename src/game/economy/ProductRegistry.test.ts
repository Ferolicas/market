import { describe, expect, it } from "vitest";
import { PRODUCTS } from "../catalog";
import { createInitialGame, normalizeGameState } from "../engine";
import { savePayloadSchema } from "../../lib/game-validation";
import { PRODUCT_CONFIG } from "./products";
import { CROP_PRODUCT_IDS, createEmptyInventory, isProductId, MACHINE_PRODUCT_IDS, PRODUCT_IDS } from "./ProductRegistry";

function payload() {
  return {
    expectedRevision: 0,
    operationId: "22222222-2222-4222-8222-222222222222",
    deviceId: "33333333-3333-4333-8333-333333333333",
    sessionId: "11111111-1111-4111-8111-111111111111",
    state: createInitialGame("ES"), events: [],
  };
}

describe("shared product contract", () => {
  it("keeps each catalog identifier unique and represented in empty stock", () => {
    expect(new Set(PRODUCT_IDS).size).toBe(PRODUCT_IDS.length);
    expect(Object.keys(PRODUCTS)).toEqual([...PRODUCT_IDS]);
    expect(Object.keys(createEmptyInventory())).toEqual([...PRODUCT_IDS]);
    expect(Object.values(createEmptyInventory()).every((value) => value === 0)).toBe(true);
  });

  it("creates independent inventories for every owner", () => {
    const first = createEmptyInventory();
    const second = createEmptyInventory();
    first.tomatoes = 8;
    expect(second.tomatoes).toBe(0);
    const state = createInitialGame();
    state.franchises[0].warehouse.tomatoes = 8;
    expect(state.franchises[1].warehouse.tomatoes).toBe(0);
    expect(state.franchises[0].returnsBin.tomatoes).toBe(0);
  });

  it("has configuration for every crop and production output", () => {
    for (const id of CROP_PRODUCT_IDS) expect(PRODUCT_CONFIG[id]?.growMs).toBeGreaterThan(0);
    for (const id of MACHINE_PRODUCT_IDS) expect(PRODUCT_CONFIG[id]?.cycleMs).toBeGreaterThan(0);
    for (const config of Object.values(PRODUCT_CONFIG)) {
      for (const id of Object.keys(config.recipe ?? {})) expect(isProductId(id)).toBe(true);
    }
  });

  it("preserves the existing schema-four save and all quantities", () => {
    const input = payload();
    for (const [index, id] of PRODUCT_IDS.entries()) {
      input.state.franchises[0].warehouse[id] = index + 10;
    }
    const parsed = savePayloadSchema.parse(JSON.parse(JSON.stringify(input)));
    expect(parsed.state.franchises[0].warehouse).toEqual(input.state.franchises[0].warehouse);
    const restored = normalizeGameState(parsed.state);
    expect(restored.franchises[0].warehouse).toEqual(input.state.franchises[0].warehouse);
    expect(restored.balanceMinor).toBe(input.state.balanceMinor);
    expect(restored.avatar).toEqual(input.state.avatar);
  });

  it.each(["warehouse", "shelves", "returnsBin"] as const)("rejects unknown or missing products in %s", (field) => {
    const extra = payload();
    (extra.state.franchises[0][field] as Record<string, number>)["unregistered-product"] = 5;
    expect(savePayloadSchema.safeParse(extra).success).toBe(false);
    const missing = payload();
    delete (missing.state.franchises[0][field] as Partial<Record<string, number>>).tomatoes;
    expect(savePayloadSchema.safeParse(missing).success).toBe(false);
  });

  it.each([-1, 0.5, NaN, Infinity, 1_000_001])("rejects invalid quantities (%s)", (quantity) => {
    const input = payload();
    input.state.franchises[0].warehouse.tomatoes = quantity;
    expect(savePayloadSchema.safeParse(input).success).toBe(false);
  });

  it.each(["constructor", "__proto__", "", null, 1])("does not recognize a non-product (%s)", (id) => {
    expect(isProductId(id)).toBe(false);
  });

  it("rejects unknown products in carried inventory", () => {
    const input = payload();
    (input.state.franchises[0].carry.items as Record<string, number>)["unregistered-product"] = 1;
    expect(savePayloadSchema.safeParse(input).success).toBe(false);
  });
});
