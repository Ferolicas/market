import { describe, expect, it } from "vitest";
import { advanceAdaptiveQuality, INITIAL_ADAPTIVE_QUALITY_STATE, legacyMobileRenderProfile, marketRenderProfileForCapabilities } from "./AdaptiveQuality";

describe("adaptive render quality", () => {
  it("regresses only after sustained over-budget frames", () => {
    let state = INITIAL_ADAPTIVE_QUALITY_STATE;
    for (let frame = 0; frame < 8; frame += 1) {
      const result = advanceAdaptiveQuality(state, 50);
      state = result.state;
      expect(result.regress).toBe(false);
    }
    const result = advanceAdaptiveQuality(state, 50);
    expect(result.regress).toBe(true);
    expect(result.state.cooldownMs).toBe(1_200);
  });

  it("recovers accumulated pressure during fast frames and respects cooldown", () => {
    const warm = advanceAdaptiveQuality({ slowForMs: 300, cooldownMs: 0 }, 16);
    expect(warm.state.slowForMs).toBe(268);
    const cooling = advanceAdaptiveQuality({ slowForMs: 500, cooldownMs: 500 }, 100);
    expect(cooling.regress).toBe(false);
    expect(cooling.state.cooldownMs).toBe(400);
  });

  it("treats a capped 30 FPS mobile frame as healthy", () => {
    const result = advanceAdaptiveQuality({ slowForMs: 300, cooldownMs: 0 }, 33.4);
    expect(result.regress).toBe(false);
    expect(result.state.slowForMs).toBeCloseTo(233.2);
  });

  it("selects a battery-first mobile renderer without reducing desktop quality", () => {
    expect(marketRenderProfileForCapabilities({ width: 390, coarsePointer: true, devicePixelRatio: 3 })).toEqual({
      mobile: true,
      dpr: 0.9,
      targetFps: 30,
      antialias: false,
      shadowMapSize: 512,
      transmissionResolutionScale: 0.5,
      powerPreference: "low-power",
    });
    expect(marketRenderProfileForCapabilities({ width: 1440, coarsePointer: false, devicePixelRatio: 2 })).toEqual({
      mobile: false,
      dpr: 1.4,
      targetFps: 60,
      antialias: true,
      shadowMapSize: 1024,
      transmissionResolutionScale: 1,
      powerPreference: "high-performance",
    });
  });

  it("keeps the historical renderer profile available only for controlled A/B measurements", () => {
    expect(legacyMobileRenderProfile({ width: 390, coarsePointer: true, devicePixelRatio: 3 })).toEqual({
      mobile: true,
      dpr: 1.204,
      targetFps: 60,
      antialias: true,
      shadowMapSize: 1024,
      transmissionResolutionScale: 1,
      powerPreference: "high-performance",
      baseline: true,
    });
  });
});
