import type { Inventory, ProductId } from "../types";
import { PRODUCT_CONFIG } from "../economy/products";
import { stationTierModifiers } from "../progression/levels";

export type CropStatus = "LOCKED" | "EMPTY" | "GROWING" | "READY" | "HARVESTING";
export type MachineStatus = "LOCKED" | "IDLE" | "WAITING_INPUT" | "PROCESSING" | "OUTPUT_READY" | "FULL";

export interface CropStation {
  id: string;
  productId: "tomatoes" | "wheat" | "corn";
  status: CropStatus;
  plantedAt: number;
  readyAt: number;
  available: number;
  tier: number;
}

export interface MachineStation {
  id: string;
  productId: "flour" | "bread" | "cheese" | "juice" | "eggs" | "milk";
  status: MachineStatus;
  input: Partial<Inventory>;
  output: number;
  outputCapacity: number;
  startedAt: number | null;
  completesAt: number | null;
  tier: number;
}

export function cropGrowthDurationMs(productId: CropStation["productId"], tier = 1, gameLevel = 1) {
  const growMs = PRODUCT_CONFIG[productId]?.growMs ?? 4_000;
  const levelSpeed = 1 + Math.min(0.5, Math.max(0, Math.floor(gameLevel) - 1) * 0.025);
  return Math.max(1_500, Math.round(growMs / stationTierModifiers(tier).speed / levelSpeed));
}

export function cropHarvestYield(productId: CropStation["productId"], tier = 1) {
  const baseBedUnits = 3;
  const productYield = PRODUCT_CONFIG[productId]?.yield ?? 1;
  return Math.max(1, Math.round(baseBedUnits * productYield * stationTierModifiers(tier).capacity));
}

export function createCrop(id: string, productId: CropStation["productId"], nowMs: number, tier = 1, gameLevel = 1): CropStation {
  return { id, productId, status: "GROWING", plantedAt: nowMs, readyAt: nowMs + cropGrowthDurationMs(productId, tier, gameLevel), available: 0, tier };
}

export function createEmptyCrop(id: string, productId: CropStation["productId"], tier = 1): CropStation {
  return { id, productId, status: "EMPTY", plantedAt: 0, readyAt: 0, available: 0, tier };
}

export function plantCrop(crop: CropStation, nowMs: number, gameLevel = 1) {
  if (crop.status !== "EMPTY") return { crop, planted: false };
  return { crop: createCrop(crop.id, crop.productId, nowMs, crop.tier, gameLevel), planted: true };
}

export function updateCrop(crop: CropStation, nowMs: number): CropStation {
  if (crop.status !== "GROWING" || nowMs < crop.readyAt) return crop;
  return { ...crop, status: "READY", available: cropHarvestYield(crop.productId, crop.tier) };
}

export function cropProgress(crop: CropStation, nowMs: number) {
  if (crop.status === "READY" || crop.status === "HARVESTING") return 1;
  if (crop.status !== "GROWING") return 0;
  return Math.min(1, Math.max(0, (nowMs - crop.plantedAt) / Math.max(1, crop.readyAt - crop.plantedAt)));
}

export function harvestCrop(cropInput: CropStation, nowMs: number, gameLevel = 1) {
  const crop = updateCrop(cropInput, nowMs);
  if (crop.status !== "READY" || crop.available < 1) return { crop, harvested: 0 };
  const remaining = crop.available - 1;
  if (remaining > 0) return { crop: { ...crop, status: "READY" as const, available: remaining }, harvested: 1 };
  return { crop: createCrop(crop.id, crop.productId, nowMs, crop.tier, gameLevel), harvested: 1 };
}

/** Composes the authoritative one-unit transition into one capacity-bounded trip. */
export function harvestCropBatch(cropInput: CropStation, nowMs: number, requested: number, gameLevel = 1) {
  const readyCrop = updateCrop(cropInput, nowMs);
  const safeRequested = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
  const harvestLimit = readyCrop.status === "READY" ? Math.min(safeRequested, readyCrop.available) : 0;
  let crop = readyCrop;
  let harvested = 0;
  for (let unit = 0; unit < harvestLimit; unit += 1) {
    const result = harvestCrop(crop, nowMs, gameLevel);
    crop = result.crop;
    harvested += result.harvested;
    if (result.harvested < 1) break;
  }
  return { crop, harvested };
}

export function createMachine(id: string, productId: MachineStation["productId"], tier = 1): MachineStation {
  return { id, productId, status: "WAITING_INPUT", input: {}, output: 0, outputCapacity: Math.round((PRODUCT_CONFIG[productId]?.shelfCapacity ?? 8) * stationTierModifiers(tier).capacity), startedAt: null, completesAt: null, tier };
}

export function loadMachine(machine: MachineStation, inventory: Inventory, nowMs: number) {
  const config = PRODUCT_CONFIG[machine.productId];
  const recipe = config?.recipe ?? {};
  const canAcceptInput = machine.status === "IDLE" || machine.status === "WAITING_INPUT";
  if (!canAcceptInput || machine.output > 0 || machine.output >= machine.outputCapacity) return { machine, inventory, loaded: false };
  for (const [productId, amount] of Object.entries(recipe) as [ProductId, number][]) {
    if ((inventory[productId] ?? 0) < amount) return { machine: { ...machine, status: "WAITING_INPUT" as const }, inventory, loaded: false };
  }
  const nextInventory = { ...inventory };
  for (const [productId, amount] of Object.entries(recipe) as [ProductId, number][]) nextInventory[productId] -= amount;
  return {
    machine: { ...machine, status: "PROCESSING" as const, startedAt: nowMs, completesAt: nowMs + (config?.cycleMs ?? 1_000) / stationTierModifiers(machine.tier).speed },
    inventory: nextInventory,
    loaded: true,
  };
}

export function updateMachine(machine: MachineStation, nowMs: number): MachineStation {
  if (machine.status !== "PROCESSING" || machine.completesAt === null || nowMs < machine.completesAt) return machine;
  const produced = PRODUCT_CONFIG[machine.productId]?.yield ?? 1;
  const output = Math.min(machine.outputCapacity, machine.output + produced);
  return { ...machine, output, status: output >= machine.outputCapacity ? "FULL" : "OUTPUT_READY", startedAt: null, completesAt: null };
}

export function collectMachineOutput(machineInput: MachineStation, nowMs: number) {
  const machine = updateMachine(machineInput, nowMs);
  if (machine.output < 1) return { machine, collected: 0 };
  const output = machine.output - 1;
  return { machine: { ...machine, output, status: output ? "OUTPUT_READY" as const : "WAITING_INPUT" as const }, collected: 1 };
}

/** Collects one trip without exceeding either available output or free carry space. */
export function collectMachineOutputBatch(machineInput: MachineStation, nowMs: number, requested: number) {
  const safeRequested = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
  let machine = updateMachine(machineInput, nowMs);
  const collectLimit = Math.min(safeRequested, machine.output);
  let collected = 0;
  for (let unit = 0; unit < collectLimit; unit += 1) {
    const result = collectMachineOutput(machine, nowMs);
    machine = result.machine;
    collected += result.collected;
    if (result.collected < 1) break;
  }
  return { machine, collected };
}
