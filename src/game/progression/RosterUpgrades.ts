import { PRODUCTS } from "../catalog";
import type { Employee, FranchiseState } from "../types";
import { animalProduction } from "../stations/FedAnimal";
import { stationTierModifiers } from "./levels";

/** Four upgrade steps per actor, each one twice the price of the previous. */
export const ROSTER_UPGRADE_STEPS = 4;
/** Living actors: player, staff and animals. 80 € in Spanish minor units. */
export const ROSTER_BASE_COST_MINOR = 8_000;
/** Machines cost three times the base of a living actor. */
export const MACHINE_BASE_COST_MINOR = ROSTER_BASE_COST_MINOR * 3;

export type RosterEntryKind = "player" | "employee" | "animal" | "machine" | "crop";

export interface RosterEntry {
  id: string;
  kind: RosterEntryKind;
  label: string;
  detail: string;
  icon: string;
  /** Upgrades already bought, 0 to ROSTER_UPGRADE_STEPS. */
  step: number;
  /** Price of each of the four steps, already scaled to the country. */
  stepCostsMinor: readonly number[];
  nextCostMinor: number | null;
  speed: number;
  capacity: number;
}

export function rosterStepCost(kind: RosterEntryKind, step: number) {
  const base = kind === "machine" ? MACHINE_BASE_COST_MINOR : ROSTER_BASE_COST_MINOR;
  return base * 2 ** Math.max(0, Math.floor(step));
}

/** Tier the purchase graph already paid for; roster steps stack on top of it. */
export function rosterBaseTier(franchise: FranchiseState, stationId: string) {
  const purchased = franchise.purchases?.purchased ?? [];
  if (stationId === "chicken-coop-1") {
    return 1 + Number(purchased.includes("chicken-1-tier-2")) + Number(purchased.includes("chicken-1-tier-3"));
  }
  if (stationId === "cow-station-1") {
    return 1 + Number(purchased.includes("cow-1-tier-2")) + Number(purchased.includes("cow-1-tier-3"));
  }
  return 1;
}

export function rosterPlayerBase(franchise: FranchiseState) {
  const upgraded = franchise.purchases?.purchased.includes("player-2") ?? false;
  return { speedTier: upgraded ? 2 : 1, capacity: upgraded ? 4 : 3 };
}

function clampStep(value: number) {
  return Math.max(0, Math.min(ROSTER_UPGRADE_STEPS, Math.floor(Number.isFinite(value) ? value : 0)));
}

function entry(
  id: string,
  kind: RosterEntryKind,
  label: string,
  detail: string,
  icon: string,
  step: number,
  tierForStats: number,
  moneyScale: number,
): RosterEntry {
  const safeStep = clampStep(step);
  const stepCostsMinor = Array.from({ length: ROSTER_UPGRADE_STEPS }, (_, index) => Math.round(rosterStepCost(kind, index) * moneyScale));
  const modifiers = stationTierModifiers(tierForStats);
  return {
    id, kind, label, detail, icon,
    step: safeStep,
    stepCostsMinor,
    nextCostMinor: safeStep >= ROSTER_UPGRADE_STEPS ? null : stepCostsMinor[safeStep],
    speed: modifiers.speed,
    capacity: modifiers.capacity,
  };
}

const ANIMAL_LABELS: Record<string, { label: string; icon: string }> = {
  "chicken-coop-1": { label: "Primera gallina", icon: "🐔" },
  "chicken-coop-2": { label: "Segunda gallina", icon: "🐔" },
  "cow-station-1": { label: "Vaca", icon: "🐄" },
};

const MACHINE_ICONS: Record<string, string> = {
  "flour-mill-1": "🌀", "bread-oven-1": "🔥", "cheese-maker-1": "🧀",
  "juice-machine-1": "🥤", "corn-canner-1": "🥫",
};

/** Everything the owner can train or tune, in one list for the team panel. */
export function rosterEntries(franchise: FranchiseState, moneyScale: number): RosterEntry[] {
  const playerBase = rosterPlayerBase(franchise);
  const playerStep = clampStep(franchise.playerSpeedTier - playerBase.speedTier);
  const entries: RosterEntry[] = [
    entry("player", "player", "Tú, el fundador",
      `Cesta ${franchise.carry.capacity} · velocidad T${franchise.playerSpeedTier}`,
      "🧍", playerStep, playerBase.speedTier + playerStep, moneyScale),
  ];
  for (const employee of franchise.employees) {
    entries.push(entry(`employee:${employee.id}`, "employee", employee.name,
      `${employeeRoleLabel(employee.role)} · cesta ${Math.min(8, 2 + employee.level)}`,
      employeeRoleIcon(employee.role), employee.level - 1, employee.level, moneyScale));
  }
  for (const machine of franchise.productionMachines) {
    if (machine.status === "LOCKED") continue;
    const animal = animalProduction(machine.productId, machine.tier);
    const baseTier = rosterBaseTier(franchise, machine.id);
    const step = clampStep(machine.tier - baseTier);
    if (animal) {
      const naming = ANIMAL_LABELS[machine.id] ?? { label: PRODUCTS[machine.productId].name, icon: "🐾" };
      entries.push(entry(`station:${machine.id}`, "animal", naming.label,
        `Produce ${PRODUCTS[machine.productId].name.toLowerCase()} · comedero ${animal.capacity}`,
        naming.icon, step, machine.tier, moneyScale));
      continue;
    }
    entries.push(entry(`station:${machine.id}`, "machine", stationLabel(machine.id, PRODUCTS[machine.productId].name),
      `Produce ${PRODUCTS[machine.productId].name.toLowerCase()} · almacén ${machine.outputCapacity}`,
      MACHINE_ICONS[machine.id] ?? "⚙️", step, machine.tier, moneyScale));
  }
  for (const crop of franchise.crops) {
    if (crop.status === "LOCKED") continue;
    entries.push(entry(`station:${crop.id}`, "crop", `Bancal de ${PRODUCTS[crop.productId].name.toLowerCase()}`,
      `Cosecha ${crop.baseYield} por ciclo`, "🌱", crop.tier - 1, crop.tier, moneyScale));
  }
  return entries;
}

function stationLabel(id: string, productName: string) {
  return ({
    "flour-mill-1": "Molino", "bread-oven-1": "Horno", "cheese-maker-1": "Quesería",
    "juice-machine-1": "Exprimidora", "corn-canner-1": "Enlatadora",
  } as Record<string, string>)[id] ?? `Estación de ${productName.toLowerCase()}`;
}

export function employeeRoleLabel(role: Employee["role"]) {
  return ({ farmer: "Granjero-reponedor", feeder: "Alimentador", operator: "Operario", stocker: "Reponedor", cashier: "Cajero", builder: "Constructor", manager: "Gerente" })[role];
}

export function employeeRoleIcon(role: Employee["role"]) {
  return ({ farmer: "🌾", feeder: "🪣", operator: "⚙️", stocker: "📦", cashier: "🧾", builder: "🔨", manager: "📋" })[role];
}
