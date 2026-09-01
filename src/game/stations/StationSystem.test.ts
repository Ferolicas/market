import { describe, expect, it } from "vitest";
import { collectMachineOutput, collectMachineOutputBatch, createCrop, createEmptyCrop, createMachine, cropGrowthDurationMs, cropHarvestYield, harvestCrop, harvestCropBatch, loadMachine, plantCrop, updateCrop, updateMachine } from "./StationSystem";
import type { Inventory } from "../types";

const emptyInventory = (): Inventory => ({ wheat: 0, flour: 0, bread: 0, corn: 0, milk: 0, eggs: 0, cheese: 0, apples: 0, tomatoes: 0, coffee: 0, juice: 0 });

describe("station systems", () => {
  it("replants automatically after the last unit is harvested", () => {
    const empty = createEmptyCrop("tomato-1", "tomatoes");
    const planted = plantCrop(empty, 1_000);
    expect(planted.planted).toBe(true);
    const crop = planted.crop;
    expect(updateCrop(crop, 4_999).status).toBe("GROWING");
    const ready = updateCrop(crop, 5_000);
    expect(ready).toMatchObject({ status: "READY", available: 3 });
    const first = harvestCrop(ready, 5_100);
    const second = harvestCrop(first.crop, 5_200);
    const third = harvestCrop(second.crop, 5_300);
    expect(first).toMatchObject({ harvested: 1, crop: { status: "READY", available: 2 } });
    expect(second).toMatchObject({ harvested: 1, crop: { status: "READY", available: 1 } });
    expect(third.harvested).toBe(1);
    expect(third.crop).toMatchObject({ status: "GROWING", available: 0, plantedAt: 5_300 });
    expect(third.crop.readyAt).toBe(9_300);
  });

  it("yields three units at tier one and scales them with the tier capacity", () => {
    expect(cropHarvestYield("tomatoes", 1)).toBe(3);
    expect(cropHarvestYield("tomatoes", 2)).toBe(4);
    expect(cropHarvestYield("wheat", 4)).toBe(5);
    expect(cropHarvestYield("corn", 10)).toBe(7);
  });

  it("harvests an exact bounded batch and starts regrowth only on the final unit", () => {
    const ready = { ...createCrop("batch", "tomatoes", 0), status: "READY" as const, available: 7 };
    const partial = harvestCropBatch(ready, 5_000, 2);
    expect(partial).toMatchObject({ harvested: 2, crop: { status: "READY", available: 5 } });

    const emptied = harvestCropBatch(partial.crop, 5_100, 20);
    expect(emptied.harvested).toBe(5);
    expect(emptied.crop).toMatchObject({ status: "GROWING", available: 0, plantedAt: 5_100 });
  });

  it("reduces growth time independently with the plot tier and player level", () => {
    const base = cropGrowthDurationMs("tomatoes", 1, 1);
    const byLevel = cropGrowthDurationMs("tomatoes", 1, 10);
    const byTier = cropGrowthDurationMs("tomatoes", 3, 1);
    const combined = cropGrowthDurationMs("tomatoes", 3, 10);

    expect(byLevel).toBeLessThan(base);
    expect(byTier).toBeLessThan(base);
    expect(combined).toBeLessThan(byLevel);
    expect(combined).toBeLessThan(byTier);
    expect(createCrop("fast-tomato", "tomatoes", 20_000, 3, 10).readyAt).toBe(20_000 + combined);
  });

  it("consumes recipes only on valid batch and never loses full output", () => {
    const inventory = emptyInventory(); inventory.wheat = 2;
    const loaded = loadMachine(createMachine("mill", "flour"), inventory, 2_000);
    expect(loaded.loaded).toBe(true);
    expect(loaded.inventory.wheat).toBe(0);
    expect(updateMachine(loaded.machine, 5_999).status).toBe("PROCESSING");
    const complete = updateMachine(loaded.machine, 6_000);
    expect(complete.output).toBe(1);
    expect(collectMachineOutput(complete, 6_000).collected).toBe(1);
  });

  it("rejects locked or output-blocked machines without mutating the station or inventory", () => {
    const inventory = emptyInventory(); inventory.wheat = 4;
    const locked = { ...createMachine("locked-mill", "flour"), status: "LOCKED" as const };
    const lockedInventory = structuredClone(inventory);
    const lockedSnapshot = structuredClone(locked);

    const rejectedLocked = loadMachine(locked, inventory, 2_000);

    expect(rejectedLocked).toEqual({ machine: lockedSnapshot, inventory: lockedInventory, loaded: false });
    expect(locked).toEqual(lockedSnapshot);
    expect(inventory).toEqual(lockedInventory);

    const outputBlocked = { ...createMachine("output-mill", "flour"), status: "OUTPUT_READY" as const, output: 1 };
    const outputSnapshot = structuredClone(outputBlocked);
    const rejectedOutput = loadMachine(outputBlocked, inventory, 2_000);

    expect(rejectedOutput).toEqual({ machine: outputSnapshot, inventory: lockedInventory, loaded: false });
    expect(outputBlocked).toEqual(outputSnapshot);
    expect(inventory).toEqual(lockedInventory);
  });

  it("collects machine output in a bounded batch and preserves every remaining unit", () => {
    const ready = { ...createMachine("batch-mill", "flour"), status: "OUTPUT_READY" as const, output: 5 };
    const partial = collectMachineOutputBatch(ready, 8_000, 3);
    expect(partial).toMatchObject({ collected: 3, machine: { status: "OUTPUT_READY", output: 2 } });

    const emptied = collectMachineOutputBatch(partial.machine, 8_100, 20);
    expect(emptied).toMatchObject({ collected: 2, machine: { status: "WAITING_INPUT", output: 0 } });
    expect(partial.collected + partial.machine.output).toBe(ready.output);
  });
});
