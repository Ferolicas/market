import type { FranchiseState, GameState, EmployeeRole } from "../types";
import { OPENING_PURCHASES } from "./MartCampaign";
import { powInt } from "../core/DeterministicMath";
import { CAMPAIGN_TASK_IDS, campaignTaskStatus } from "./CampaignTasks";
import { campaignContracts } from "./CampaignContracts";

/** Existing purchase graph supplies levels 2–28; personal mastery supplies 29–30.
 * No XP, idle time or separate level payment can substitute these requirements. */
export function campaignLevel(franchise: FranchiseState): number {
  if (!franchise.purchases) return 1;
  const bought = OPENING_PURCHASES.filter((item) => franchise.purchases!.purchased.includes(item.id)).length;
  if (bought < OPENING_PURCHASES.length) return 1 + bought;
  if (!CAMPAIGN_TASK_IDS.every((id) => campaignTaskStatus(id, franchise.purchases!.personalProgress, franchise.id).completed)) return 28;
  return campaignContracts(franchise).every((contract) => contract.completed) ? 30 : 29;
}

/** Sale prices grow 3 % per campaign level, compounding: the same unit sells
 * for more as the store unlocks. Level 1 sells at the base price. */
export const CAMPAIGN_PRICE_GROWTH_PER_LEVEL = 0.03;

export function campaignPriceMultiplier(level: number) {
  const step = Math.max(0, Math.min(30, Number.isFinite(level) ? Math.floor(level) : 1) - 1);
  // Repeated multiplication, not `**`: the multiplier reaches prices and the
  // save authority on both the client and the replaying server.
  return powInt(1 + CAMPAIGN_PRICE_GROWTH_PER_LEVEL, step);
}

export function campaignGlobalLevel(state: GameState) {
  return Math.max(1, ...state.franchises.filter((item) => item.owned).map(campaignLevel));
}

/** Levels that hand the store a dedicated cashier, on top of the purchases.
 * Authored by the owner: the first till gets staffed early, the second
 * cashier opens the second till and the third opens the third one. */
export const CASHIER_UNLOCK_LEVELS = [5, 10, 20] as const;

export function campaignCashierSlots(level: number) {
  return CASHIER_UNLOCK_LEVELS.filter((threshold) => level >= threshold).length;
}

/** Purchases that each bring one worker of a role, authored by the owner so
 * the finished store staffs 8 farmer-stockers, 3 feeders and 5 operators
 * (plus the 3 cashiers the levels grant): the three farmer desks, the second
 * farm and every new crop bring a farmer; every pen brings its feeder; every
 * machine brings its operator. */
export const CAMPAIGN_STAFF_PURCHASES: Record<Exclude<EmployeeRole, "cashier" | "stocker" | "builder" | "manager">, readonly string[]> = {
  farmer: ["farmer-1", "farmer-2", "farmer-3", "expansion-1", "wheat-1", "corn-1", "apple-1", "orange-1"],
  feeder: ["chicken-1", "cow-1", "chicken-2"],
  operator: ["flour-mill-1", "bread-oven-1", "cheese-maker-1", "juice-machine-1", "corn-canner-1"],
};

/** Total slots, including staff granted by purchases and by level rewards. */
export function campaignEmployeeLimit(franchise: FranchiseState, role: EmployeeRole) {
  const owns = (id: string) => franchise.purchases?.purchased.some((item) => item === id) ?? false;
  switch (role) {
    case "cashier": return campaignCashierSlots(campaignLevel(franchise));
    case "farmer": return CAMPAIGN_STAFF_PURCHASES.farmer.filter(owns).length;
    case "feeder": return CAMPAIGN_STAFF_PURCHASES.feeder.filter(owns).length;
    case "operator": return CAMPAIGN_STAFF_PURCHASES.operator.filter(owns).length;
    // Stocking is the granjero-reponedor's own job and building is automatic,
    // so the campaign no longer opens these desks.
    case "stocker": return 0;
    case "builder": return 0;
    case "manager": return 0;
  }
}
