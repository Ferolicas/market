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
