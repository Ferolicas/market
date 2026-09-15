import type { FranchiseState, GameState, EmployeeRole } from "../types";
import { OPENING_PURCHASES } from "./MartCampaign";
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

export function campaignGlobalLevel(state: GameState) {
  return Math.max(1, ...state.franchises.filter((item) => item.owned).map(campaignLevel));
}

/** Levels that hand the store a dedicated cashier, on top of the purchases. */
export const CASHIER_UNLOCK_LEVELS = [10, 20, 30] as const;

export function campaignCashierSlots(level: number) {
  return CASHIER_UNLOCK_LEVELS.filter((threshold) => level >= threshold).length;
}

/** Total slots, including staff granted by purchases and by level rewards. */
export function campaignEmployeeLimit(franchise: FranchiseState, role: EmployeeRole) {
  const owns = (id: string) => franchise.purchases?.purchased.some((item) => item === id) ?? false;
  switch (role) {
    case "cashier": return campaignCashierSlots(campaignLevel(franchise));
    case "farmer": return owns("farmer-3") ? 3 : owns("farmer-2") ? 2 : owns("farmer-1") ? 1 : 0;
    case "feeder": return owns("cow-1") ? 1 : 0;
    case "operator": return owns("cheese-maker-1") ? 2 : owns("flour-mill-1") ? 1 : 0;
    // Stocking is the granjero-reponedor's own job and building is automatic,
    // so the campaign no longer opens these desks.
    case "stocker": return 0;
    case "builder": return 0;
    case "manager": return 0;
  }
}
