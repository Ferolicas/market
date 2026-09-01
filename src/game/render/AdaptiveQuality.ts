export interface AdaptiveQualityState {
  slowForMs: number;
  cooldownMs: number;
}

export interface AdaptiveQualityConfig {
  slowFrameMs: number;
  sustainedSlowMs: number;
  cooldownMs: number;
  recoveryRate: number;
}

export const MOBILE_ADAPTIVE_QUALITY: AdaptiveQualityConfig = {
  slowFrameMs: 28,
  sustainedSlowMs: 420,
  cooldownMs: 1_200,
  recoveryRate: 2,
};

export const INITIAL_ADAPTIVE_QUALITY_STATE: AdaptiveQualityState = {
  slowForMs: 0,
  cooldownMs: 0,
};

/** Pure sustained-frame-budget gate for R3F performance.regress(). */
export function advanceAdaptiveQuality(
  previous: AdaptiveQualityState,
  frameMs: number,
  config: AdaptiveQualityConfig = MOBILE_ADAPTIVE_QUALITY,
): { state: AdaptiveQualityState; regress: boolean } {
  const safeFrameMs = Math.max(0, Math.min(250, Number.isFinite(frameMs) ? frameMs : 0));
  const cooldownMs = Math.max(0, previous.cooldownMs - safeFrameMs);
  const slowForMs = safeFrameMs >= config.slowFrameMs
    ? previous.slowForMs + safeFrameMs
    : Math.max(0, previous.slowForMs - safeFrameMs * config.recoveryRate);
  if (cooldownMs === 0 && slowForMs >= config.sustainedSlowMs) {
    return {
      state: { slowForMs: 0, cooldownMs: config.cooldownMs },
      regress: true,
    };
  }
  return { state: { slowForMs, cooldownMs }, regress: false };
}
