/**
 * Walkable service point beside the visible supplier terminal, delivery pallet
 * and reserve rack. The scene scales these authored layout coordinates exactly
 * like the furniture and NavMesh; no visible floor pad is required.
 */
export const WAREHOUSE_PICKUP_STATION = {
  interactionId: "supplier",
  label: "Recoger mercancía del almacén",
  // West side of the visible delivery pallet. Unlike the narrow gap between
  // endcap and dock, this cell survives Recast actor-radius erosion and can be
  // reached by the same kinematic capsule used in browser play.
  position: [7.4, 0, -3.4] as const,
  enterRadius: 0.75,
  exitRadius: 0.9,
  dwellMs: 80,
  repeatEveryMs: 220,
  exitGraceMs: 120,
} as const;

/**
 * Return crate beside the farm door, inside the store. It serves every worker
 * (the owner/player and automated employees), never customers. A stocker whose
 * destination shelf filled up returns their complete remaining carry here.
 * The door's left post sits at x = 7.5 − 1.82 = 5.68 and the operations wall
 * ends at x ≈ 3.1, so the crate footprint (4.33–5.17) blocks neither the
 * threshold corridor nor the wall fixtures. Authored in layout units.
 */
export const WAREHOUSE_RETURN_STATION = {
  interactionId: "warehouseReturn",
  obstacleId: "fixture:warehouse-return",
  label: "Devolver cesta al almacén",
  position: [4.75, 0, -7.72] as const,
  footprint: { halfX: 0.42, halfZ: 0.32 },
  // Reachable point in front of the solid basket footprint. Workers navigate
  // here rather than into the collider/NavMesh obstacle at its centre.
  workerPosition: [4.75, -6.7] as const,
  enterRadius: 0.82,
  exitRadius: 0.98,
  dwellMs: 80,
  repeatEveryMs: 60_000,
  exitGraceMs: 120,
} as const;
