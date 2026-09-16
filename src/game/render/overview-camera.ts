/**
 * Fixed isometric camera: offset from the player focus in scaled simulation
 * units (layout × STORE_LAYOUT_SCALE horizontally, world height vertically).
 * Shared by the scene and by layout rules that must know what the camera can
 * see, such as the strip of farm ground the rear wall hides.
 */
export const OVERVIEW_CAMERA_OFFSET = { x: 16, y: 23, z: 25.75 } as const;

/**
 * Depth of ground, measured along −z behind a wall that faces the camera,
 * that the wall hides at ground level: a view ray from a point that far back
 * just clears the wall's top. Same units as the wall height.
 */
export function wallGroundShadowDepth(wallHeight: number) {
  return wallHeight * OVERVIEW_CAMERA_OFFSET.z / OVERVIEW_CAMERA_OFFSET.y;
}
