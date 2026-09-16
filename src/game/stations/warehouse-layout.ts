import { CONTACT_MAGNET_REACH } from "../interaction/InteractionZone";
/**
 * Walkable service point beside the visible supplier terminal, delivery pallet
 * and reserve rack. The scene scales these authored layout coordinates exactly
 * like the furniture and NavMesh; no visible floor pad is required.
 */
/** Where stockers and operators collect warehouse goods: in front of the
 * orders block on the rear wall, shared with the player's pickup sensor. */
export const STOCKROOM_POINT: [number, number] = [0.9, -5.2];

/**
 * The orders terminal on the rear wall. Warehouse goods are taken from the
 * PEDIDOS panel, never by walking past: an automatic proximity pickup filled
 * the basket with produce the owner had not asked for.
 */
export const WAREHOUSE_ORDERS_TERMINAL = {
  label: "Pedidos y almacén",
  position: [STOCKROOM_POINT[0], 0, STOCKROOM_POINT[1]] as const,
} as const;

/**
 * Tall return crate on the rear wall beside the orders block, inside the
 * store. It serves every worker (the owner/player and automated employees),
 * never customers. A stocker whose destination shelf filled up returns their
 * complete remaining carry here. The orders footprint ends at x ≈ 1.66 and the
 * farm door's left post sits at x = 7.5 − 1.82 = 5.68, so the crate footprint
 * (2.43–3.77) blocks neither. Authored in layout units.
 */
export const WAREHOUSE_RETURN_STATION = {
  interactionId: "warehouseReturn",
  obstacleId: "fixture:warehouse-return",
  label: "Devolver cesta al almacén",
  position: [3.1, 0, -7.85] as const,
  footprint: { halfX: 0.84, halfZ: 0.32 },
  // Reachable point in front of the solid crate footprint. Workers navigate
  // here rather than into the collider/NavMesh obstacle at its centre.
  workerPosition: [3.1, -6.5] as const,
  // Contact reach in scaled simulation units: the crate works when touched.
  enterRadius: CONTACT_MAGNET_REACH.enter,
  exitRadius: CONTACT_MAGNET_REACH.exit,
  dwellMs: 80,
  repeatEveryMs: 60_000,
  exitGraceMs: 120,
} as const;
