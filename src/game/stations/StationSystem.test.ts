import { describe, expect, it } from "vitest";
import { createEmptyInventory } from "../economy/ProductRegistry";
import { collectMachineOutput, collectMachineOutputBatch, createCrop, createEmptyCrop, createMachine, cropGrowthDurationMs, cropHarvestYield, harvestCrop, harvestCropBatch, loadMachine, machineInputCapacity, machineQueuedCycles, plantCrop, updateCrop, updateMachine } from "./StationSystem";

const emptyInventory = createEmptyInventory;

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
    expect(cropHarvestYield("corn", 10)).toBe(6);
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

  it("uses three cultivated oranges—not tomatoes—to make one juice", () => {
    const inventory = emptyInventory(); inventory.oranges = 3; inventory.tomatoes = 2;
    const loaded = loadMachine(createMachine("juicer", "juice"), inventory, 2_000);
    expect(loaded.loaded).toBe(true);
    expect(loaded.inventory.oranges).toBe(0);
    expect(loaded.inventory.tomatoes).toBe(2);
    const complete = updateMachine(loaded.machine, 7_000);
    expect(complete).toMatchObject({ status: "OUTPUT_READY", output: 1 });
  });

  it("rejects a locked machine or a full queue without mutating the station or inventory", () => {
    const inventory = emptyInventory(); inventory.wheat = 4;
    const locked = { ...createMachine("locked-mill", "flour"), status: "LOCKED" as const };
    const lockedInventory = structuredClone(inventory);
    const lockedSnapshot = structuredClone(locked);

    const rejectedLocked = loadMachine(locked, inventory, 2_000);

    expect(rejectedLocked).toEqual({ machine: lockedSnapshot, inventory: lockedInventory, loaded: false });
    expect(locked).toEqual(lockedSnapshot);
    expect(inventory).toEqual(lockedInventory);

    const full = { ...createMachine("full-mill", "flour"), status: "PROCESSING" as const, input: { wheat: 16 }, startedAt: 1_000, completesAt: 5_000 };
    const fullSnapshot = structuredClone(full);
    const rejectedFull = loadMachine(full, inventory, 2_000);

    expect(rejectedFull).toEqual({ machine: fullSnapshot, inventory: lockedInventory, loaded: false });
    expect(full).toEqual(fullSnapshot);
    expect(inventory).toEqual(lockedInventory);
  });

  it("queues a whole batch of ingredient and works through it without gaps", () => {
    // Tier 2 mill: output buffer 10, so the queue takes 20 wheat for 10 flours.
    const mill = createMachine("queue-mill", "flour", 2);
    expect(mill.outputCapacity).toBe(10);
    expect(machineInputCapacity(mill, "wheat")).toBe(20);
    const inventory = emptyInventory(); inventory.wheat = 23;
    const loaded = loadMachine(mill, inventory, 2_000);
    expect(loaded.loaded).toBe(true);
    expect(loaded.inventory.wheat).toBe(3);
    // The first recipe is already in the drum; the rest waits in the queue.
    expect(loaded.machine).toMatchObject({ status: "PROCESSING", input: { wheat: 18 }, completesAt: 5_200 });
    expect(machineQueuedCycles(loaded.machine)).toBe(9);

    const midway = updateMachine(loaded.machine, 2_000 + 3_200 * 3 + 1);
    expect(midway).toMatchObject({ status: "PROCESSING", output: 3, input: { wheat: 12 } });
    expect(midway.completesAt).toBe(2_000 + 3_200 * 4);

    const done = updateMachine(loaded.machine, 2_000 + 3_200 * 10);
    expect(done).toMatchObject({ status: "FULL", output: 10, input: {} });
    expect(updateMachine(done, 100_000)).toEqual(done);
  });

  it("holds the queue while the buffer is full and resumes when a unit is collected", () => {
    const mill = createMachine("held-mill", "flour");
    const inventory = emptyInventory(); inventory.wheat = 16;
    const loaded = loadMachine(mill, inventory, 0).machine;
    const full = updateMachine({ ...loaded, input: { wheat: 18 } }, 4_000 * 8);
    expect(full).toMatchObject({ status: "FULL", output: 8, input: { wheat: 4 } });
    const collected = collectMachineOutput(full, 40_000);
    expect(collected.collected).toBe(1);
    expect(collected.machine).toMatchObject({ status: "PROCESSING", output: 7, input: { wheat: 2 }, completesAt: 44_000 });
    const emptied = collectMachineOutputBatch(collected.machine, 44_000, 20);
    expect(emptied).toMatchObject({ collected: 8, machine: { status: "PROCESSING", output: 0, input: {} } });
    expect(updateMachine(emptied.machine, 48_000)).toMatchObject({ status: "OUTPUT_READY", output: 1, input: {} });
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
