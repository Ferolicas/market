import type { OpeningPurchaseId } from "../progression/MartCampaign";
import { FARM_ANIMAL_STATIONS, FARM_PLOTS, FARM_WORKER_HOME } from "./farm-layout";
import { productionFixtureForWorkstation } from "./production-layout";
import { RETAIL_DEPARTMENTS } from "./retail-layout";
import { STORE_REAR_DOOR } from "./storefront-layout";

/** Clear front-of-store service space, away from checkout and pantry sockets. */
export const PURCHASE_POINT: [number, number, number] = [-3.8, 0.06, 4.8];

const plot = (id: string): [number, number, number] => {
  const found = FARM_PLOTS.find((candidate) => candidate.id === id)!;
  return [found.position[0], 0.06, found.position[2]];
};
const machine = (id: Parameters<typeof productionFixtureForWorkstation>[0]): [number, number, number] => {
  const fixture = productionFixtureForWorkstation(id);
  return [fixture.operatorWorkPoint[0], 0.06, fixture.operatorWorkPoint[1]];
};
const department = (id: keyof typeof RETAIL_DEPARTMENTS): [number, number, number] => {
  const service = RETAIL_DEPARTMENTS[id].service;
  return [service[0], 0.06, service[1]];
};
const animal = (id: keyof typeof FARM_ANIMAL_STATIONS, offsetX = 0): [number, number, number] => {
  const station = FARM_ANIMAL_STATIONS[id];
  return [station.workPosition[0] + offsetX, 0.06, station.workPosition[2]];
};
const worker = (offsetX: number): [number, number, number] => [FARM_WORKER_HOME[0] + offsetX, 0.06, FARM_WORKER_HOME[1]];

/**
 * Every purchase is paid where the thing itself will stand, so the golden
 * ring is a permanent price tag on the floor instead of one shared socket
 * beside the entrance. Points are authored layout units, pre-scale, and are
 * chosen on walkable cells (service points, operator work points, crop beds).
 */
export const PURCHASE_POSITIONS: Record<OpeningPurchaseId, [number, number, number]> = {
  "farmer-1": worker(0),
  "farmer-2": worker(1.4),
  "farmer-3": worker(2.8),
  "egg-display-1": department("eggs"),
  "chicken-1": animal("chicken"),
  "chicken-1-tier-2": animal("chicken", -1.1),
  "chicken-1-tier-3": animal("chicken", 1.1),
  "chicken-2": animal("chicken2"),
  "cow-1": animal("cow"),
  "cow-1-tier-2": animal("cow", -1.1),
  "cow-1-tier-3": animal("cow", 1.1),
  "player-2": [...PURCHASE_POINT],
  "tomato-2": plot("crop-tomato-2"),
  "tomato-3": plot("crop-tomato-3"),
  "wheat-1": plot("crop-wheat-1"),
  "corn-1": plot("crop-corn-1"),
  "apple-1": plot("crop-apple-1"),
  "orange-1": plot("crop-orange-1"),
  // The expansion is signed at the rear service door it opens.
  "expansion-1": [STORE_REAR_DOOR.insideApproach[0], 0.06, STORE_REAR_DOOR.insideApproach[1]],
  "flour-mill-1": machine("mill"),
  "bread-oven-1": machine("bakery"),
  "cheese-maker-1": machine("cheese"),
  "juice-machine-1": machine("juice"),
  "corn-canner-1": machine("canner"),
  "dairy-display-1": department("dairy"),
  "coffee-supply-1": department("pantry"),
  "preserves-supply-1": department("preserves"),
};

export type PurchaseInteractionId = `purchase:${OpeningPurchaseId}`;

export function purchaseInteractionId(id: OpeningPurchaseId): PurchaseInteractionId {
  return `purchase:${id}`;
}

export function isPurchaseInteractionId(id: string): id is PurchaseInteractionId {
  return id.startsWith("purchase:");
}

export function purchaseIdFromInteraction(id: PurchaseInteractionId): OpeningPurchaseId {
  return id.slice("purchase:".length) as OpeningPurchaseId;
}

/** Reach of the payment ring, in element units before STORE_ELEMENT_SCALE. */
export const PURCHASE_RING = { enterRadius: 0.75, exitRadius: 0.95, radius: 0.62 } as const;
