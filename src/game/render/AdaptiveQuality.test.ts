import { describe, expect, it } from "vitest";
import { advanceAdaptiveQuality, INITIAL_ADAPTIVE_QUALITY_STATE } from "./AdaptiveQuality";

describe("adaptive render quality", () => {
  it("regresses only after sustained over-budget frames", () => {
    let state = INITIAL_ADAPTIVE_QUALITY_STATE;
    for (let frame = 0; frame < 12; frame += 1) {
      const result = advanceAdaptiveQuality(state, 32);
      state = result.state;
      expect(result.regress).toBe(false);
    }
    const result = advanceAdaptiveQuality(state, 40);
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
});
