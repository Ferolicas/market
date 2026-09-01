import { describe, expect, it } from "vitest";
import {
  advanceRearDoorMotion,
  CLOSED_REAR_DOOR_MOTION,
  rearDoorActorPresent,
  rearDoorClearWidth,
  rearDoorLeafCenter,
  rearDoorWallPanels,
  rearDoorWallSegments,
  STORE_REAR_DOOR,
  STOREFRONT_LAYOUT,
  storefrontDoorClearWidth,
  storefrontDoorLeafCenter,
  storefrontDoorProgress,
} from "./storefront-layout";

describe("storefront layout", () => {
  it("uses double-height leaves and clears the complete framed opening", () => {
    const { door } = STOREFRONT_LAYOUT;

    expect(door.leafHeight).toBe(5.4);
    expect(storefrontDoorLeafCenter(-1, 0)).toBe(-door.closedCenterOffset);
    expect(storefrontDoorLeafCenter(1, 1)).toBe(door.closedCenterOffset + door.openTravel);
    expect(storefrontDoorClearWidth(1)).toBeGreaterThanOrEqual(door.outerPostX * 2);
  });

  it("clamps incomplete or invalid animation progress before placing colliders", () => {
    expect(storefrontDoorProgress(-1)).toBe(0);
    expect(storefrontDoorProgress(2)).toBe(1);
    expect(storefrontDoorProgress(Number.NaN)).toBe(0);
  });

  it("authors one aligned rear opening for render, physics and navigation", () => {
    const { door } = STORE_REAR_DOOR;
    const segments = rearDoorWallSegments();
    const openingHalfWidth = door.outerPostOffset + door.postWidth / 2;

    expect(segments).toHaveLength(2);
    expect(segments[0].centerX - segments[0].width / 2).toBeCloseTo(-STORE_REAR_DOOR.wallHalfWidth, 6);
    expect(segments[0].centerX + segments[0].width / 2).toBeCloseTo(STORE_REAR_DOOR.x - openingHalfWidth, 6);
    expect(segments[1].centerX - segments[1].width / 2).toBeCloseTo(STORE_REAR_DOOR.x + openingHalfWidth, 6);
    expect(segments[1].centerX + segments[1].width / 2).toBeCloseTo(STORE_REAR_DOOR.wallHalfWidth, 6);
    expect(rearDoorLeafCenter(-1, 0)).toBeCloseTo(STORE_REAR_DOOR.x - door.closedCenterOffset, 6);
    expect(rearDoorLeafCenter(1, 1)).toBeCloseTo(STORE_REAR_DOOR.x + door.closedCenterOffset + door.openTravel, 6);
    expect(rearDoorClearWidth(1)).toBeGreaterThanOrEqual(door.outerPostOffset * 2);
    expect(STORE_REAR_DOOR.insideApproach[0]).toBe(STORE_REAR_DOOR.x);
    expect(STORE_REAR_DOOR.outsideApproach[0]).toBe(STORE_REAR_DOOR.x);
  });

  it("keeps every decorative rear-wall panel outside the physical doorway", () => {
    const wallSegments = rearDoorWallSegments();

    rearDoorWallPanels().forEach((panel) => {
      const panelLeft = panel.centerX - panel.width / 2;
      const panelRight = panel.centerX + panel.width / 2;
      const containingWall = wallSegments.find((segment) => (
        panelLeft >= segment.centerX - segment.width / 2
        && panelRight <= segment.centerX + segment.width / 2
      ));
      expect(containingWall, `panel ${panel.centerX}/${panel.width} must remain on a solid wall`).toBeDefined();
    });
  });

  it("opens before an actor reaches the threshold, holds, then closes completely", () => {
    expect(rearDoorActorPresent(STORE_REAR_DOOR.insideApproach)).toBe(true);
    expect(rearDoorActorPresent(STORE_REAR_DOOR.outsideApproach)).toBe(true);
    expect(rearDoorActorPresent([STORE_REAR_DOOR.x - 3, STORE_REAR_DOOR.z])).toBe(false);

    const advanceFor = (initial: typeof CLOSED_REAR_DOOR_MOTION, occupied: boolean, durationMs: number) => {
      let state = { ...initial };
      for (let elapsed = 0; elapsed < durationMs; elapsed += 50) {
        state = advanceRearDoorMotion(state, occupied, Math.min(50, durationMs - elapsed));
      }
      return state;
    };
    let motion = { ...CLOSED_REAR_DOOR_MOTION };
    motion = advanceFor(motion, true, STORE_REAR_DOOR.motion.openMs);
    expect(motion).toEqual({ progress: 1, emptyForMs: 0 });
    motion = advanceFor(motion, false, STORE_REAR_DOOR.motion.holdOpenMs - 1);
    expect(motion.progress).toBe(1);
    motion = advanceRearDoorMotion(motion, false, 1);
    expect(motion.progress).toBe(1);
    motion = advanceFor(motion, false, STORE_REAR_DOOR.motion.closeMs);
    expect(motion.progress).toBe(0);
  });
});
