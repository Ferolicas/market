import type { OpeningPurchaseId } from "../progression/MartCampaign";

/** Clear front-of-store service space, away from checkout and pantry sockets. */
export const PURCHASE_POINT: [number, number, number] = [-3.8, 0.06, 4.8];

/**
 * Measured, walkable spots **beside or behind** each element, never on the
 * path the owner uses to work it: paying is something you choose to do by
 * stepping aside, not a toll you pay while collecting eggs. Every point is
 * checked by purchase-layout.test.ts against the NavMesh, the obstacles and
 * the distance to every work and service socket.
 */
export const PURCHASE_POSITIONS: Record<OpeningPurchaseId, [number, number, number]> = {
  // Farm hands are signed on the open apron inside the gate, clear of the beds.
  "farmer-1": [-7.2, 0.06, -11],
  "farmer-2": [-5.6, 0.06, -11],
  "farmer-3": [-4, 0.06, -11],
  // Behind the pens: the front of each pen stays free to feed and collect.
  "chicken-1": [1.2, 0.06, -15.9],
  "chicken-1-tier-2": [1.2, 0.06, -15.9],
  "chicken-1-tier-3": [1.2, 0.06, -15.9],
  "chicken-2": [8.8, 0.06, -15.4],
  "cow-1": [5.35, 0.06, -16.4],
  "cow-1-tier-2": [5.35, 0.06, -16.4],
  "cow-1-tier-3": [5.35, 0.06, -16.4],
  // A bed that does not exist yet has no harvest pass to block.
  "tomato-2": [-3.55, 0.06, -12.72],
  "tomato-3": [-0.6, 0.06, -11.2],
  "wheat-1": [-6.3, 0.06, -15.45],
  "corn-1": [-3.55, 0.06, -15.45],
  "apple-1": [-9, 0.06, -15.45],
  "orange-1": [-0.75, 0.06, -14],
  // Store floor, always off the aisle and away from the service sockets.
  "player-2": [...PURCHASE_POINT],
  "egg-display-1": [-8.6, 0.06, -1.75],
  "dairy-display-1": [-9.5, 0.06, 4.3],
  "coffee-supply-1": [-0.5, 0.06, -1.2],
  "preserves-supply-1": [10.2, 0.06, -2.8],
  "expansion-1": [5.2, 0.06, -7.8],
  "flour-mill-1": [-10.9, 0.06, -5.2],
  "bread-oven-1": [-7.3, 0.06, -5.9],
  "cheese-maker-1": [-6.4, 0.06, -2.6],
  "juice-machine-1": [-5.4, 0.06, -7.6],
  "corn-canner-1": [10.6, 0.06, -5.6],
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
