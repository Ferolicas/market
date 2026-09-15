import { FRANCHISE_TEMPLATES } from "../catalog";
import type { FranchiseState, GameState } from "../types";
import { CAMPAIGN_TASK_IDS, campaignTaskStatus } from "./CampaignTasks";
import { OPENING_PURCHASES } from "./MartCampaign";
import { campaignContracts } from "./CampaignContracts";

export function campaignMasteryProgress(franchise: FranchiseState) {
  const tasks = CAMPAIGN_TASK_IDS.map((id) => campaignTaskStatus(id, franchise.purchases?.personalProgress, franchise.id));
  const completedPurchases = OPENING_PURCHASES.filter((item) => franchise.purchases?.purchased.includes(item.id)).length;
  const contracts = campaignContracts(franchise);
  return 100 * (completedPurchases + tasks.reduce((sum, task) => sum + task.progress / task.target, 0) + contracts.filter((contract) => contract.completed).length) / (OPENING_PURCHASES.length + tasks.length + contracts.length);
}

/** Original progression across the existing locations, not reference levels.
 * Every product chain and personal task must be mastered in the preceding store. */
export function campaignExpansionQuote(state: GameState, franchiseId: string) {
  const index = FRANCHISE_TEMPLATES.findIndex((item) => item.id === franchiseId);
  const target = state.franchises.find((item) => item.id === franchiseId);
  const previous = index > 0 ? state.franchises.find((item) => item.id === FRANCHISE_TEMPLATES[index - 1].id) : undefined;
  const purchases = previous?.purchases;
  const missingPurchases = OPENING_PURCHASES.filter((item) => !purchases?.purchased.includes(item.id));
  const tasks = CAMPAIGN_TASK_IDS.map((id) => campaignTaskStatus(id, purchases?.personalProgress, previous?.id));
  const contracts = previous ? campaignContracts(previous) : [];
  const available = Boolean(target && !target.owned && previous?.owned && purchases && !missingPurchases.length && tasks.every((task) => task.completed) && contracts.every((contract) => contract.completed));
  return { available, previousName: previous?.name, costMinor: target?.purchaseCostMinor ?? 0, missingPurchases, tasks, contracts,
    reason: !previous?.owned ? "Abre primero el local anterior"
      : missingPurchases.length ? `Completa ${missingPurchases.length} compras en ${previous.name}`
      : tasks.some((task) => !task.completed) ? `Completa tu trabajo personal en ${previous.name}`
      : contracts.some((contract) => !contract.completed) ? `Entrega los encargos personales de ${previous.name}`
      : "Supermercado anterior completado" };
}
