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

/** Total slots, including staff granted by purchases. Shared by UI and engine. */
export function campaignEmployeeLimit(franchise: FranchiseState, role: EmployeeRole) {
  const owns = (id: string) => franchise.purchases?.purchased.some((item) => item === id) ?? false;
  switch (role) {
    case "cashier": return owns("expansion-1") ? 2 : owns("cashier-1") ? 1 : 0;
    case "farmer": return owns("farmer-2") ? 2 : owns("farmer-1") ? 1 : 0;
    case "operator": return owns("cheese-maker-1") ? 2 : owns("flour-mill-1") ? 1 : 0;
    case "stocker": return owns("expansion-1") ? 1 : 0;
    case "builder": return owns("expansion-1") ? 1 : 0;
    case "manager": return owns("cheese-maker-1") && owns("juice-machine-1") && owns("coffee-supply-1") ? 1 : 0;
  }
}
