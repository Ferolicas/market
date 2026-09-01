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
