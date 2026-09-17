import type { OpeningPurchaseId } from "./MartCampaign";
import { campaignLocation } from "./CampaignLocations";
import type { ProductId } from "../economy/ProductRegistry";

/** Original balance: personal work, not employee totals, unlocks expansion. */
export const CAMPAIGN_TASKS = {
  "player:harvest:tomatoes": { label: "Cosecha tú 8 tomates", target: 8 },
  "player:stock:tomatoes": { label: "Repón tú 8 tomates", target: 8 },
  "player:feed:chicken": { label: "Alimenta tú las gallinas con 4 tomates", target: 4 },
  "player:stock:eggs": { label: "Repón tú 4 huevos", target: 4 },
  "player:harvest:wheat": { label: "Cosecha tú 6 trigos", target: 6 },
  "player:collect:flour": { label: "Recoge tú 3 harinas del molino", target: 3 },
  "player:stock:bread": { label: "Repón tú 4 panes", target: 4 },
  "player:feed:cow": { label: "Alimenta tú la vaca con 2 trigos", target: 2 },
  "player:stock:milk": { label: "Repón tú 4 leches", target: 4 },
  "player:stock:cheese": { label: "Repón tú 4 quesos", target: 4 },
  "player:harvest:apples": { label: "Cosecha tú 4 manzanas", target: 4 },
  "player:stock:corn": { label: "Repón tú 4 maíces", target: 4 },
  "player:harvest:coffee": { label: "Cosecha tú 4 cafés", target: 4 },
  "player:stock:coffee": { label: "Repón tú 4 cafés", target: 4 },
  "player:harvest:oranges": { label: "Cosecha tú 4 naranjas", target: 4 },
  "player:stock:juice": { label: "Repón tú 4 zumos", target: 4 },
  "player:stock:cannedCorn": { label: "Repón tú 4 conservas de maíz", target: 4 },
  "player:collect:cannedCorn": { label: "Recoge tú 3 conservas de la enlatadora", target: 3 },
} as const;
export type CampaignTaskId = keyof typeof CAMPAIGN_TASKS;
export const CAMPAIGN_TASK_IDS = Object.keys(CAMPAIGN_TASKS) as CampaignTaskId[];
export type CampaignTaskProgress = Partial<Record<CampaignTaskId, number>>;

export const PURCHASE_TASK_REQUIREMENTS: Partial<Record<OpeningPurchaseId, readonly CampaignTaskId[]>> = {
  "expansion-1": ["player:harvest:tomatoes", "player:stock:tomatoes", "player:feed:chicken", "player:stock:eggs"],
  "flour-mill-1": ["player:harvest:wheat"],
  "bread-oven-1": ["player:collect:flour"],
  "dairy-display-1": ["player:stock:bread"],
  "cheese-maker-1": ["player:feed:cow", "player:stock:milk"],
  "orange-1": ["player:harvest:apples"],
  "juice-machine-1": ["player:harvest:oranges"],
};

export function campaignTaskTarget(id: CampaignTaskId, locationId = "barrio") {
  const profile = campaignLocation(locationId);
  const product = id === "player:feed:chicken" ? "eggs" : id === "player:feed:cow" ? "milk" : id.split(":").at(-1) as ProductId;
  return CAMPAIGN_TASKS[id].target * (profile.focus.includes(product) ? profile.focusMultiplier : profile.masteryMultiplier);
}

export function campaignTaskStatus(id: CampaignTaskId, progress: CampaignTaskProgress = {}, locationId = "barrio") {
  const task = CAMPAIGN_TASKS[id];
  const target = campaignTaskTarget(id, locationId);
  const label = task.label.replace(/\d+/, String(target));
  const count = Math.min(target, Math.max(0, progress[id] ?? 0));
  return { id, label, target, progress: count, completed: count >= target, unit: "count" as const };
}

export function purchaseTasks(id: OpeningPurchaseId, progress: CampaignTaskProgress = {}) {
  return (PURCHASE_TASK_REQUIREMENTS[id] ?? []).map((task) => campaignTaskStatus(task, progress));
}

/** Capped deltas bound save/event volume; repeats after mastery add nothing. */
export function addCampaignTaskProgress(progress: CampaignTaskProgress, deltas: CampaignTaskProgress, locationId = "barrio") {
  const result = { ...progress };
  for (const id of CAMPAIGN_TASK_IDS) {
    const delta = deltas[id] ?? 0;
    if (Number.isSafeInteger(delta) && delta > 0) result[id] = Math.min(campaignTaskTarget(id, locationId), (progress[id] ?? 0) + delta);
  }
  return result;
}
