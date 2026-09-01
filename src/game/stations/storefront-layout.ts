export const STOREFRONT_LAYOUT = {
  z: 7.8,
  wallHeight: 5.6,
  door: {
    leafWidth: 1.68,
    leafHeight: 5.4,
    leafDepth: 0.065,
    closedCenterOffset: 0.86,
    openTravel: 1.84,
    outerPostX: 1.82,
    postWidth: 0.1,
    frameDepth: 0.14,
  },
} as const;

/**
 * Rear service entrance shared by the building renderer, Rapier, Recast and
 * fallback employee routes. Coordinates are in the unscaled store layout.
 *
 * The doorway is aligned with the estate gate at x=7.5. Keeping the complete
 * opening here prevents the former failure mode where a decorative opening
 * existed while the rear-wall collider and navigation band stayed solid.
 */
export const STORE_REAR_DOOR = {
  x: 7.5,
  z: -8.45,
  wallCenterZ: -8.55,
  wallHalfWidth: 11.5,
  wallDepth: 0.32,
  insideApproach: [7.5, -6.9] as const,
  outsideApproach: [7.5, -9.35] as const,
  /** Clear interior aisle from the central sales floor to the threshold. */
  interiorCorridor: [
    [2.2, 0.45],
    [2.2, -3.2],
    [2.7, -3.65],
    [6.8, -6.35],
    [7.5, -6.9],
  ] as const,
  // The backroom rack is authored here as well because its former x=8.65
  // footprint invaded the new passage after navigation clearance was added.
  adjacentRackPosition: [9.65, 0, -7.85] as const,
  door: {
    leafWidth: 1.28,
    leafHeight: 3.35,
    leafDepth: 0.07,
    closedCenterOffset: 0.64,
    openTravel: 1.37,
    outerPostOffset: 1.36,
    postWidth: 0.12,
    frameDepth: 0.2,
  },
  sensor: {
    enterRadius: 2.25,
    exitRadius: 2.65,
    actorHalfWidth: 2.2,
    actorHalfDepth: 2.45,
  },
  motion: {
    openMs: 310,
    closeMs: 360,
    holdOpenMs: 760,
  },
} as const;

export interface RearDoorMotionState {
  progress: number;
  emptyForMs: number;
}

export const CLOSED_REAR_DOOR_MOTION: RearDoorMotionState = {
  progress: 0,
  emptyForMs: 0,
};

export function storefrontDoorProgress(progress: number) {
  return Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
}

export function storefrontDoorLeafCenter(side: -1 | 1, progress: number) {
  const door = STOREFRONT_LAYOUT.door;
  return side * (door.closedCenterOffset + storefrontDoorProgress(progress) * door.openTravel);
}

export function storefrontDoorClearWidth(progress: number) {
  const door = STOREFRONT_LAYOUT.door;
  return Math.max(0, Math.abs(storefrontDoorLeafCenter(1, progress)) * 2 - door.leafWidth);
}

export function rearDoorLeafCenter(side: -1 | 1, progress: number) {
  const door = STORE_REAR_DOOR.door;
  return STORE_REAR_DOOR.x + side * (
    door.closedCenterOffset + storefrontDoorProgress(progress) * door.openTravel
  );
}

export function rearDoorClearWidth(progress: number) {
  const door = STORE_REAR_DOOR.door;
  return Math.max(0, Math.abs(rearDoorLeafCenter(1, progress) - rearDoorLeafCenter(-1, progress)) - door.leafWidth);
}

/** Solid rear-wall pieces on either side of the authored doorway. */
export function rearDoorWallSegments() {
  const openingHalfWidth = STORE_REAR_DOOR.door.outerPostOffset + STORE_REAR_DOOR.door.postWidth / 2;
  const leftEdge = -STORE_REAR_DOOR.wallHalfWidth;
  const rightEdge = STORE_REAR_DOOR.wallHalfWidth;
  const openingLeft = STORE_REAR_DOOR.x - openingHalfWidth;
  const openingRight = STORE_REAR_DOOR.x + openingHalfWidth;
  return [
    { centerX: (leftEdge + openingLeft) / 2, width: openingLeft - leftEdge },
    { centerX: (openingRight + rightEdge) / 2, width: rightEdge - openingRight },
  ] as const;
}

/** Decorative inner panels constrained to the same solid wall segments. */
export function rearDoorWallPanels() {
  const rightWall = rearDoorWallSegments()[1];
  return [
    { centerX: -7.4, width: 3.3 },
    { centerX: -3.7, width: 3.3 },
    { centerX: 0, width: 3.3 },
    { centerX: 3.7, width: 3.3 },
    { centerX: rightWall.centerX, width: rightWall.width - 0.36 },
  ] as const;
}

export function rearDoorActorPresent(point: readonly [number, number]) {
  return Math.abs(point[0] - STORE_REAR_DOOR.x) <= STORE_REAR_DOOR.sensor.actorHalfWidth
    && Math.abs(point[1] - STORE_REAR_DOOR.z) <= STORE_REAR_DOOR.sensor.actorHalfDepth;
}

/** Pure state transition used by the client animation and layout tests. */
export function advanceRearDoorMotion(
  current: RearDoorMotionState,
  occupied: boolean,
  deltaMs: number,
): RearDoorMotionState {
  const safeDelta = Math.max(0, Math.min(250, Number.isFinite(deltaMs) ? deltaMs : 0));
  if (occupied) {
    const progress = Math.min(1, storefrontDoorProgress(current.progress) + safeDelta / STORE_REAR_DOOR.motion.openMs);
    return {
      progress: progress > 1 - 1e-9 ? 1 : progress,
      emptyForMs: 0,
    };
  }
  const previousEmptyForMs = Math.max(0, current.emptyForMs);
  const emptyForMs = Math.min(
    STORE_REAR_DOOR.motion.holdOpenMs + STORE_REAR_DOOR.motion.closeMs,
    previousEmptyForMs + safeDelta,
  );
  const closingDeltaMs = Math.max(0, emptyForMs - STORE_REAR_DOOR.motion.holdOpenMs)
    - Math.max(0, previousEmptyForMs - STORE_REAR_DOOR.motion.holdOpenMs);
  const progress = Math.max(0, storefrontDoorProgress(current.progress) - closingDeltaMs / STORE_REAR_DOOR.motion.closeMs);
  return {
    progress: progress < 1e-9 ? 0 : progress,
    emptyForMs,
  };
}
