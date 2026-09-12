export interface AdaptiveQualityState {
  slowForMs: number;
  cooldownMs: number;
  healthyForMs: number;
}

export interface AdaptiveQualityConfig {
  slowFrameMs: number;
  sustainedSlowMs: number;
  cooldownMs: number;
  recoveryRate: number;
  /** Continuous in-budget presentation required before one regressed
   * resolution step is handed back. */
  recoverAfterMs: number;
}

export interface MarketRenderCapabilities {
  width: number;
  coarsePointer: boolean;
  devicePixelRatio?: number;
}

export interface MarketRenderProfile {
  mobile: boolean;
  dpr: number;
  /** Lowest resolution the adaptive controller may fall back to. */
  minDpr: number;
  targetFps: 30 | 60;
  motionFps: 30 | 60;
  antialias: boolean;
  shadowMapSize: 512 | 1024;
  transmissionResolutionScale: 0.5 | 1;
  /** Physical glass keeps its tint, opacity, clearcoat and environment
   * response everywhere. The separate transmission scene pass, which redraws
   * every opaque object and re-resolves every program twice per frame, only
   * runs where the profile allows it. */
  glassTransmission: boolean;
  powerPreference: "low-power" | "high-performance";
  baseline?: boolean;
}

/** One adaptive resolution step (multiplicative). */
export const ADAPTIVE_DPR_STEP = 0.86;
/** Programs for late Suspense content (customers, accessories) still compile
 * shortly after the scene is declared ready; that warm-up must not count as
 * sustained pressure. */
export const ADAPTIVE_QUALITY_GRACE_MS = 2_500;

export const MOBILE_ADAPTIVE_QUALITY: AdaptiveQualityConfig = {
  // Mobile intentionally renders at 30 FPS. A healthy 33 ms frame must not
  // be mistaken for GPU pressure and trigger another quality reduction.
  slowFrameMs: 40,
  sustainedSlowMs: 420,
  cooldownMs: 1_200,
  recoveryRate: 2,
  recoverAfterMs: 8_000,
};

export const MOBILE_MOTION_ADAPTIVE_QUALITY: AdaptiveQualityConfig = {
  ...MOBILE_ADAPTIVE_QUALITY,
  // At 60 Hz, sustained 24 ms presentation frames indicate that resolution
  // should step down before uneven cadence becomes visible.
  slowFrameMs: 24,
  sustainedSlowMs: 650,
};

/** Balanced renderer policy. Mobile keeps a low-power 30 FPS idle loop and
 * presents locomotion at 60 FPS. Both platforms render at (or near) the
 * panel's native density: drawing fewer pixels than the screen has and
 * stretching them is what reads as a pixelated character. The adaptive
 * controller only steps below that after sustained, measured pressure and
 * hands the resolution back once frames are healthy again. */
export function marketRenderProfileForCapabilities(capabilities: MarketRenderCapabilities): MarketRenderProfile {
  const mobile = capabilities.coarsePointer || capabilities.width <= 820;
  const deviceDpr = Number.isFinite(capabilities.devicePixelRatio)
    ? capabilities.devicePixelRatio as number
    : 1;
  if (mobile) {
    return {
      mobile: true,
      // DPR 1.25 on a DPR 3 phone stretched every rendered pixel 2.4 times.
      // Two device pixels per CSS pixel keeps silhouettes and faces crisp;
      // the third one on flagship panels is not worth its fill cost here.
      dpr: Math.max(1, Math.min(2, deviceDpr)),
      minDpr: Math.max(1, Math.min(1.5, deviceDpr)),
      targetFps: 30,
      motionFps: 60,
      antialias: true,
      shadowMapSize: 512,
      transmissionResolutionScale: 0.5,
      glassTransmission: false,
      powerPreference: "low-power",
    };
  }
  return {
    mobile: false,
    dpr: Math.max(0.85, Math.min(2, deviceDpr)),
    minDpr: 0.85,
    targetFps: 60,
    motionFps: 60,
    antialias: true,
    shadowMapSize: 1024,
    transmissionResolutionScale: 1,
    glassTransmission: true,
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
    minDpr: 0.75,
    targetFps: 60,
    motionFps: 60,
    antialias: true,
    shadowMapSize: 1024,
    transmissionResolutionScale: 1,
    glassTransmission: true,
    powerPreference: "high-performance",
    baseline: true,
  };
}

export const INITIAL_ADAPTIVE_QUALITY_STATE: AdaptiveQualityState = {
  slowForMs: 0,
  cooldownMs: 0,
  healthyForMs: 0,
};

/** Pure sustained-frame-budget gate. `regress` asks for one resolution step
 * down; `recover` reports that presentation has stayed in budget long enough
 * to hand one step back. */
export function advanceAdaptiveQuality(
  previous: AdaptiveQualityState,
  frameMs: number,
  config: AdaptiveQualityConfig = MOBILE_ADAPTIVE_QUALITY,
): { state: AdaptiveQualityState; regress: boolean; recover: boolean } {
  const safeFrameMs = Math.max(0, Math.min(250, Number.isFinite(frameMs) ? frameMs : 0));
  const cooldownMs = Math.max(0, previous.cooldownMs - safeFrameMs);
  const slow = safeFrameMs >= config.slowFrameMs;
  const slowForMs = slow
    ? previous.slowForMs + safeFrameMs
    : Math.max(0, previous.slowForMs - safeFrameMs * config.recoveryRate);
  const healthyForMs = slow ? 0 : previous.healthyForMs + safeFrameMs;
  if (cooldownMs === 0 && slowForMs >= config.sustainedSlowMs) {
    return {
      state: { slowForMs: 0, cooldownMs: config.cooldownMs, healthyForMs: 0 },
      regress: true,
      recover: false,
    };
  }
  if (healthyForMs >= config.recoverAfterMs) {
    return {
      state: { slowForMs, cooldownMs, healthyForMs: 0 },
      regress: false,
      recover: true,
    };
  }
  return { state: { slowForMs, cooldownMs, healthyForMs }, regress: false, recover: false };
}

/** Next canvas DPR after one adaptive step down, never below the profile floor. */
export function regressedDpr(currentDpr: number, profile: MarketRenderProfile) {
  return Math.max(profile.minDpr, currentDpr * ADAPTIVE_DPR_STEP);
}

/** Next canvas DPR after handing one adaptive step back, never above the profile. */
export function recoveredDpr(currentDpr: number, profile: MarketRenderProfile) {
  return Math.min(profile.dpr, currentDpr / ADAPTIVE_DPR_STEP);
}

/**
 * Manual-loop presentation cadence. Time-based gating ("present when 16.7 ms
 * have elapsed") drifts against the panel's own vsync and produces alternating
 * short/long frames on 90 Hz and 120 Hz phones. Counting animation-frame
 * ticks against the measured refresh interval presents on an even sub-multiple
 * instead: 60 Hz → every tick, 120 Hz → every second tick, 90 Hz → every
 * second tick (45 FPS, even) rather than 60 FPS with a 22/11 ms stutter.
 */
export class DisplayCadenceEstimator {
  private readonly deltas: number[];
  private index = 0;
  private filled = 0;
  private lastTickMs: number | null = null;

  constructor(windowSize = 48) {
    this.deltas = new Array<number>(Math.max(4, windowSize)).fill(0);
  }

  /** Records one animation-frame timestamp (ms) and returns the estimated
   * refresh interval in ms. A slow main thread only ever lengthens frame
   * deltas, so the minimum over the recent window tracks the true vsync. */
  observe(tickMs: number) {
    if (this.lastTickMs !== null) {
      const delta = tickMs - this.lastTickMs;
      if (delta > 0) {
        this.deltas[this.index] = Math.min(50, Math.max(4, delta));
        this.index = (this.index + 1) % this.deltas.length;
        this.filled = Math.min(this.deltas.length, this.filled + 1);
      }
    }
    this.lastTickMs = tickMs;
    return this.refreshIntervalMs();
  }

  refreshIntervalMs() {
    if (this.filled === 0) return 1_000 / 60;
    let minimum = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.filled; i += 1) minimum = Math.min(minimum, this.deltas[i]);
    return minimum;
  }

  reset() {
    this.filled = 0;
    this.index = 0;
    this.lastTickMs = null;
  }
}

/** Number of animation-frame ticks between presentations for a target rate. */
export function presentationDivisor(refreshIntervalMs: number, targetFps: number) {
  const refreshHz = 1_000 / Math.max(1, refreshIntervalMs);
  return Math.max(1, Math.round(refreshHz / Math.max(1, targetFps)));
}
