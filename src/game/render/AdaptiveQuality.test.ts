import { describe, expect, it } from "vitest";
import {
  advanceAdaptiveQuality,
  DisplayCadenceEstimator,
  INITIAL_ADAPTIVE_QUALITY_STATE,
  legacyMobileRenderProfile,
  marketRenderProfileForCapabilities,
  MOBILE_ADAPTIVE_QUALITY,
  presentationDivisor,
  recoveredDpr,
  regressedDpr,
} from "./AdaptiveQuality";

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
    expect(result.recover).toBe(false);
    expect(result.state.cooldownMs).toBe(1_200);
  });

  it("recovers accumulated pressure during fast frames and respects cooldown", () => {
    const warm = advanceAdaptiveQuality({ slowForMs: 300, cooldownMs: 0, healthyForMs: 0 }, 16);
    expect(warm.state.slowForMs).toBe(268);
    expect(warm.state.healthyForMs).toBe(16);
    const cooling = advanceAdaptiveQuality({ slowForMs: 500, cooldownMs: 500, healthyForMs: 0 }, 100);
    expect(cooling.regress).toBe(false);
    expect(cooling.state.cooldownMs).toBe(400);
  });

  it("treats a capped 30 FPS mobile frame as healthy", () => {
    const result = advanceAdaptiveQuality({ slowForMs: 300, cooldownMs: 0, healthyForMs: 0 }, 33.4);
    expect(result.regress).toBe(false);
    expect(result.state.slowForMs).toBeCloseTo(233.2);
  });

  it("hands one step back only after a long run of in-budget frames", () => {
    let state = INITIAL_ADAPTIVE_QUALITY_STATE;
    let recovered = 0;
    for (let frame = 0; frame < 700; frame += 1) {
      const result = advanceAdaptiveQuality(state, 16.7);
      state = result.state;
      if (result.recover) recovered += 1;
    }
    // 700 × 16.7 ms ≈ 11.7 s: exactly one recovery at 8 s, counter restarted.
    expect(recovered).toBe(1);
    expect(state.healthyForMs).toBeLessThan(MOBILE_ADAPTIVE_QUALITY.recoverAfterMs);
    // A single slow frame restarts the healthy streak.
    const interrupted = advanceAdaptiveQuality({ slowForMs: 0, cooldownMs: 0, healthyForMs: 7_900 }, 60);
    expect(interrupted.state.healthyForMs).toBe(0);
    expect(interrupted.recover).toBe(false);
  });

  it("steps resolution down and back within the profile bounds", () => {
    const mobile = marketRenderProfileForCapabilities({ width: 390, coarsePointer: true, devicePixelRatio: 3 });
    const once = regressedDpr(mobile.dpr, mobile);
    expect(once).toBeCloseTo(1.72);
    const twice = regressedDpr(once, mobile);
    expect(twice).toBe(mobile.minDpr);
    expect(recoveredDpr(twice, mobile)).toBeCloseTo(1.744);
    expect(recoveredDpr(1.95, mobile)).toBe(mobile.dpr);
  });

  it("renders at native density on both platforms, without glass transmission passes on mobile", () => {
    expect(marketRenderProfileForCapabilities({ width: 390, coarsePointer: true, devicePixelRatio: 3 })).toEqual({
      mobile: true,
      dpr: 2,
      minDpr: 1.5,
      targetFps: 30,
      motionFps: 60,
      antialias: true,
      shadowMapSize: 512,
      transmissionResolutionScale: 0.5,
      glassTransmission: false,
      powerPreference: "low-power",
    });
    expect(marketRenderProfileForCapabilities({ width: 390, coarsePointer: true, devicePixelRatio: 1 }).dpr).toBe(1);
    expect(marketRenderProfileForCapabilities({ width: 1440, coarsePointer: false, devicePixelRatio: 2 })).toEqual({
      mobile: false,
      dpr: 2,
      minDpr: 0.85,
      targetFps: 60,
      motionFps: 60,
      antialias: true,
      shadowMapSize: 1024,
      transmissionResolutionScale: 1,
      glassTransmission: true,
      powerPreference: "high-performance",
    });
    expect(marketRenderProfileForCapabilities({ width: 1920, coarsePointer: false, devicePixelRatio: 1 }).dpr).toBe(1);
    expect(marketRenderProfileForCapabilities({ width: 2560, coarsePointer: false, devicePixelRatio: 3 }).dpr).toBe(2);
  });

  it("keeps the historical renderer profile available only for controlled A/B measurements", () => {
    expect(legacyMobileRenderProfile({ width: 390, coarsePointer: true, devicePixelRatio: 3 })).toEqual({
      mobile: true,
      dpr: 1.204,
      minDpr: 0.75,
      targetFps: 60,
      motionFps: 60,
      antialias: true,
      shadowMapSize: 1024,
      transmissionResolutionScale: 1,
      glassTransmission: true,
      powerPreference: "high-performance",
      baseline: true,
    });
  });
});

describe("manual loop presentation cadence", () => {
  function feed(estimator: DisplayCadenceEstimator, deltas: number[]) {
    let now = 1_000;
    let interval = estimator.observe(now);
    for (const delta of deltas) {
      now += delta;
      interval = estimator.observe(now);
    }
    return interval;
  }

  it("estimates the panel refresh from the shortest recent frame delta", () => {
    expect(feed(new DisplayCadenceEstimator(), [16.6, 16.8, 16.7, 33.4, 16.7, 50])).toBeCloseTo(16.6);
    expect(feed(new DisplayCadenceEstimator(), [8.3, 8.4, 16.7, 8.3])).toBeCloseTo(8.3);
    expect(feed(new DisplayCadenceEstimator(), [11.1, 11.2, 22.2, 11.1])).toBeCloseTo(11.1);
    expect(new DisplayCadenceEstimator().refreshIntervalMs()).toBeCloseTo(16.667);
  });

  it("presents on an even sub-multiple of the refresh rate", () => {
    expect(presentationDivisor(16.7, 60)).toBe(1);
    expect(presentationDivisor(16.7, 30)).toBe(2);
    expect(presentationDivisor(8.33, 60)).toBe(2);
    expect(presentationDivisor(8.33, 30)).toBe(4);
    expect(presentationDivisor(11.1, 60)).toBe(2);
    expect(presentationDivisor(11.1, 30)).toBe(3);
    // A 30 Hz low-power panel simply presents every tick.
    expect(presentationDivisor(33.3, 60)).toBe(1);
    expect(presentationDivisor(33.3, 30)).toBe(1);
  });

  it("ignores stale history after a reset", () => {
    const estimator = new DisplayCadenceEstimator(8);
    feed(estimator, [8.3, 8.3, 8.3]);
    estimator.reset();
    expect(feed(estimator, [16.7, 16.7])).toBeCloseTo(16.7);
  });
});
