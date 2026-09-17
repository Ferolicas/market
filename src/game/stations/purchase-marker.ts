/**
 * The pay marker is a small square on the floor beside the thing it buys,
 * with a standing sign that names it and shows what is left to pay. Sizes are
 * in element units (scaled by STORE_ELEMENT_SCALE in the scene); the enter and
 * exit radii are the magnet around the square's centre.
 */
export const PURCHASE_MARKER = {
  halfSize: 0.34,
  enterRadius: 0.5,
  exitRadius: 0.7,
  /** The sign stands behind the square (−z), so the fixed camera reads it above the square. */
  signOffsetZ: -0.62,
  signHeight: 1.18,
} as const;
