import { describe, expect, it } from "vitest";
import { cameraRelativeMovement, DEFAULT_PLAYER_MOTION, moveVelocity, PLAYER_MAX_SPEED_MULTIPLIER, PLAYER_TIER_ONE_SPEED_MULTIPLIER, playerMotionForTier } from "./PlayerController";

describe("player controller", () => {
  it("maps screen input through camera forward", () => {
    expect(cameraRelativeMovement({ x: 0, y: -1, magnitude: 1 }, { x: 0, y: -1 })).toEqual({ x: 0, y: -1 });
    expect(cameraRelativeMovement({ x: 1, y: 0, magnitude: 1 }, { x: 0, y: -1 })).toEqual({ x: 1, y: 0 });
    expect(cameraRelativeMovement({ x: -1, y: 0, magnitude: 1 }, { x: 0, y: -1 })).toEqual({ x: -1, y: 0 });
  });

  it("accelerates and brakes in units per second", () => {
    const accelerated = moveVelocity({ x: 0, y: 0 }, { x: 1, y: 0 }, 1 / 60);
    expect(accelerated.x).toBeCloseTo(0.2);
    const stopped = moveVelocity({ x: 0.1, y: 0 }, { x: 0, y: 0 }, 1 / 60);
    expect(stopped).toEqual({ x: 0, y: 0 });
  });

  it("progresa del 60% inicial al 100% anterior en diez tiers", () => {
    const tierOne = playerMotionForTier(1);
    const tierTwo = playerMotionForTier(2);
    const tierTen = playerMotionForTier(10);

    expect(tierOne.walkSpeed).toBeCloseTo(DEFAULT_PLAYER_MOTION.walkSpeed * PLAYER_TIER_ONE_SPEED_MULTIPLIER);
    expect(tierOne.walkSpeed).toBeCloseTo(3.564);
    expect(tierTen.walkSpeed).toBeCloseTo(DEFAULT_PLAYER_MOTION.walkSpeed * PLAYER_MAX_SPEED_MULTIPLIER);
    expect(tierTen.walkSpeed).toBeCloseTo(5.94);
    expect(tierOne.acceleration).toBe(DEFAULT_PLAYER_MOTION.acceleration * PLAYER_MAX_SPEED_MULTIPLIER);
    expect(tierOne.braking).toBe(DEFAULT_PLAYER_MOTION.braking * PLAYER_MAX_SPEED_MULTIPLIER);
    expect(tierTwo.walkSpeed).toBeGreaterThan(tierOne.walkSpeed);
    expect(playerMotionForTier(99)).toEqual(tierTen);
  });

  it("normaliza tiers persistidos inválidos antes de calcular movimiento", () => {
    expect(playerMotionForTier(Number.NaN)).toEqual(playerMotionForTier(1));
    expect(playerMotionForTier(-3)).toEqual(playerMotionForTier(1));
  });
});
