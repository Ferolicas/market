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

export interface MarketRenderCapabilities {
  width: number;
  coarsePointer: boolean;
  devicePixelRatio?: number;
}

export interface MarketRenderProfile {
  mobile: boolean;
  dpr: number;
  targetFps: 30 | 60;
  antialias: boolean;
  shadowMapSize: 512 | 1024;
  transmissionResolutionScale: 0.5 | 1;
  powerPreference: "low-power" | "high-performance";
  baseline?: boolean;
}

export const MOBILE_ADAPTIVE_QUALITY: AdaptiveQualityConfig = {
  // Mobile intentionally renders at 30 FPS. A healthy 33 ms frame must not
  // be mistaken for GPU pressure and trigger another quality reduction.
  slowFrameMs: 40,
  sustainedSlowMs: 420,
  cooldownMs: 1_200,
  recoveryRate: 2,
};

/** Battery-first renderer policy. Mobile uses half as many presentation frames,
 * no multisample buffer and less than one physical pixel per CSS pixel.
 * Simulation rules remain independent and authoritative. */
export function marketRenderProfileForCapabilities(capabilities: MarketRenderCapabilities): MarketRenderProfile {
  const mobile = capabilities.coarsePointer || capabilities.width <= 820;
  const deviceDpr = Number.isFinite(capabilities.devicePixelRatio)
    ? capabilities.devicePixelRatio as number
    : 1;
  if (mobile) {
    return {
      mobile: true,
      // Rendering below the panel's native DPR is the largest predictable GPU
      // and battery saving on high-density phones. R3F may regress it further
      // under sustained pressure.
      dpr: Math.max(0.8, Math.min(0.9, deviceDpr)),
      targetFps: 30,
      antialias: false,
      shadowMapSize: 512,
      transmissionResolutionScale: 0.5,
      powerPreference: "low-power",
    };
  }
  return {
    mobile: false,
    dpr: Math.max(0.85, Math.min(1.4, deviceDpr)),
    targetFps: 60,
    antialias: true,
    shadowMapSize: 1024,
    transmissionResolutionScale: 1,
    powerPreference: "high-performance",
  };
}

/** Historical mobile settings retained exclusively by the gated QA build.
 * This provides a same-code, same-assets baseline and is never selected by a
 * public production build. */
export function legacyMobileRenderProfile(capabilities: MarketRenderCapabilities): MarketRenderProfile {
  const deviceDpr = Number.isFinite(capabilities.devicePixelRatio)
    ? capabilities.devicePixelRatio as number
    : 1;
  return {
    mobile: true,
    dpr: Math.max(0.85, Math.min(1.4, deviceDpr)) * 0.86,
    targetFps: 60,
    antialias: true,
    shadowMapSize: 1024,
    transmissionResolutionScale: 1,
    powerPreference: "high-performance",
    baseline: true,
  };
}

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
