import type { FranchiseState } from "../types";
import { OPENING_PURCHASES, openingPurchaseCost, type OpeningPurchaseId } from "./MartCampaign";
import type { CountryCode } from "../types";
import { purchaseTasks, type CampaignTaskProgress } from "./CampaignTasks";
import type { CampaignContractId } from "./CampaignContracts";

export interface PurchaseState {
  version: 1;
  /** Purchases inherited from an old save are never charged again. */
  inherited: OpeningPurchaseId[];
  purchased: OpeningPurchaseId[];
  contributions: Partial<Record<OpeningPurchaseId, number>>;
  personalProgress?: CampaignTaskProgress;
  completedContracts?: CampaignContractId[];
}
export function createPurchaseState(): PurchaseState {
  return { version: 1, inherited: [], purchased: [], contributions: {} };
}

export function migratePurchases(franchise: FranchiseState, legacyLevel: number): PurchaseState {
  const granted = new Set<OpeningPurchaseId>();
  const grant = (id: OpeningPurchaseId) => {
    if (granted.has(id)) return;
    for (const prerequisite of OPENING_PURCHASES.find((purchase) => purchase.id === id)!.requires) grant(prerequisite);
    granted.add(id);
  };
  const crops = { "crop-tomato-2": "tomato-2", "crop-tomato-3": "tomato-3", "crop-wheat-1": "wheat-1", "crop-apple-1": "apple-1", "crop-corn-1": "corn-1", "crop-orange-1": "orange-1" } as const;
  for (const [station, purchase] of Object.entries(crops)) if (franchise.crops.some((crop) => crop.id === station && crop.status !== "LOCKED")) grant(purchase);
  const machines = { "flour-mill-1": "flour-mill-1", "bread-oven-1": "bread-oven-1", "chicken-coop-1": "chicken-1", "chicken-coop-2": "chicken-2", "cow-station-1": "cow-1", "cheese-maker-1": "cheese-maker-1", "juice-machine-1": "juice-machine-1" } as const;
  for (const [station, purchase] of Object.entries(machines)) if (franchise.productionMachines.some((machine) => machine.id === station && machine.status !== "LOCKED")) grant(purchase);
  const farmers = franchise.employees.filter((employee) => employee.role === "farmer").length;
  if (farmers >= 1) grant("farmer-1");
  if (farmers >= 2) grant("farmer-2");
  if (farmers >= 3) grant("farmer-3");
  if (franchise.carry.capacity >= 4) grant("player-2");
  if (legacyLevel >= 9) grant("coffee-supply-1");
  for (const [station, prefix] of [["chicken-coop-1", "chicken-1"], ["cow-station-1", "cow-1"]] as const) {
    const machine = franchise.productionMachines.find((candidate) => candidate.id === station && candidate.status !== "LOCKED");
    if (machine && machine.tier >= 2) grant(`${prefix}-tier-2`);
    if (machine && machine.tier >= 3) grant(`${prefix}-tier-3`);
  }
  const purchased = OPENING_PURCHASES.filter((purchase) => granted.has(purchase.id)).map((purchase) => purchase.id);
  return { version: 1, inherited: [...purchased], purchased, contributions: {} };
}

export function purchaseQuote(state: PurchaseState, id: OpeningPurchaseId, country: CountryCode) {
  const definition = OPENING_PURCHASES.find((purchase) => purchase.id === id);
  const costMinor = openingPurchaseCost(id, country);
  const completed = state.purchased.includes(id);
  const contributedMinor = state.contributions[id] ?? 0;
  const tasks = purchaseTasks(id, state.personalProgress);
  const dependenciesMet = Boolean(definition && definition.requires.every((dependency) => state.purchased.includes(dependency)));
  return { id, label: definition?.label ?? "Compra desconocida", costMinor, contributedMinor, completed,
    tasks, dependenciesMet,
    available: Boolean(definition && !completed && costMinor !== null && dependenciesMet && tasks.every((task) => task.completed)),
    remainingMinor: completed ? 0 : costMinor === null ? null : Math.max(0, costMinor - contributedMinor) };
}

/** A purchase is paid by standing on its marker: the whole price flows in
 * PURCHASE_CONTRIBUTION_FILL_MS whatever the amount (a quarter per second),
 * one pulse every PURCHASE_CONTRIBUTION_PULSE_MS, so 1 000 € pays 250 €/s. */
export const PURCHASE_CONTRIBUTION_FILL_MS = 4_000;
export const PURCHASE_CONTRIBUTION_PULSE_MS = 200;

export function purchaseContributionPulseMinor(costMinor: number) {
  if (!Number.isFinite(costMinor) || costMinor <= 0) return 0;
  return Math.max(1, Math.ceil(costMinor * PURCHASE_CONTRIBUTION_PULSE_MS / PURCHASE_CONTRIBUTION_FILL_MS));
}

export function contributePurchase(state: PurchaseState, id: OpeningPurchaseId, country: CountryCode, walletMinor: number, requestedMinor: number) {
  const quote = purchaseQuote(state, id, country);
  if (!quote.available || quote.remainingMinor === null || !Number.isSafeInteger(requestedMinor) || requestedMinor <= 0
    || !Number.isSafeInteger(walletMinor) || walletMinor < 0) return { state, spentMinor: 0, completedNow: false };
  const spentMinor = Math.min(walletMinor, requestedMinor, quote.remainingMinor);
  if (!spentMinor) return { state, spentMinor, completedNow: false };
  const total = quote.contributedMinor + spentMinor;
  const completedNow = total === quote.costMinor;
  return { state: { ...state, contributions: { ...state.contributions, [id]: total }, purchased: completedNow ? [...state.purchased, id] : [...state.purchased] }, spentMinor, completedNow };
}
