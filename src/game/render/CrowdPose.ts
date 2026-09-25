import { CROWD_FPS, crowdFrameRow, type CrowdAnimationManifest, type CrowdClipName } from "./CrowdAnimation";

/**
 * Per-character animation state for the crowd renderer: which baked clip a
 * body plays, how far into it, and the clip it is fading out of. The result
 * is three numbers per instance (row A, row B, blend) that the vertex shader
 * turns into a pose; no AnimationMixer, no bone objects, no matrices on the
 * main thread.
 */
export interface CrowdPoseState {
  clip: CrowdClipName;
  /** Clip time in seconds, already scaled by the gait speed. */
  time: number;
  previousClip: CrowdClipName | null;
  previousTime: number;
  /** Seconds since the current clip started fading in. */
  fade: number;
}

export interface CrowdPoseRows {
  rowA: number;
  rowB: number;
  /** Weight of row B (the clip fading out). */
  blend: number;
}

export const CROWD_FADE_SECONDS = 0.2;
/** The same clip-speed clamp the locomotion controller applies to mixers. */
export const CROWD_TIME_SCALE_RANGE = { min: 0.55, max: 2.8 } as const;
const CYCLIC_GAITS = new Set<CrowdClipName>(["Walk", "Run", "CarryWalk", "CarryRun", "BasketWalk"]);

export function createCrowdPose(clip: CrowdClipName, startTime = 0): CrowdPoseState {
  return { clip, time: startTime, previousClip: null, previousTime: 0, fade: CROWD_FADE_SECONDS };
}

/** Advances a pose by `deltaSeconds`, switching to `requested` with a
 * cross-fade when it differs; cyclic gaits keep their phase across the switch
 * so a walk turning into a run does not restart the stride. */
export function advanceCrowdPose(state: CrowdPoseState, requested: CrowdClipName, deltaSeconds: number, timeScale: number, manifest: CrowdAnimationManifest, fadeSeconds = CROWD_FADE_SECONDS): CrowdPoseState {
  const scale = timeScale === 0 ? 0 : Math.min(CROWD_TIME_SCALE_RANGE.max, Math.max(CROWD_TIME_SCALE_RANGE.min, timeScale));
  const delta = Math.max(0, deltaSeconds);
  if (requested !== state.clip && manifest.clips[requested]) {
    const previous = manifest.clips[state.clip];
    const next = manifest.clips[requested]!;
    const phase = previous && CYCLIC_GAITS.has(state.clip) && CYCLIC_GAITS.has(requested) && previous.duration > 0
      ? ((state.time % previous.duration) + previous.duration) % previous.duration / previous.duration
      : 0;
    return { clip: requested, time: phase * next.duration + delta * scale, previousClip: state.clip, previousTime: state.time, fade: 0 };
  }
  return { ...state, time: state.time + delta * scale, previousTime: state.previousTime + delta * scale, fade: Math.min(fadeSeconds, state.fade + delta) };
}

/** Texture rows and blend for the shader; `rowB` repeats `rowA` once the
 * fade is over so the shader always samples two rows without branching. */
export function crowdPoseRows(state: CrowdPoseState, manifest: CrowdAnimationManifest, fadeSeconds = CROWD_FADE_SECONDS): CrowdPoseRows {
  const current = manifest.clips[state.clip] ?? manifest.clips.Idle;
  if (!current) return { rowA: 0, rowB: 0, blend: 0 };
  const rowA = crowdFrameRow(current, state.time, CROWD_FPS);
  const previous = state.previousClip ? manifest.clips[state.previousClip] : undefined;
  if (!previous || state.fade >= fadeSeconds) return { rowA, rowB: rowA, blend: 0 };
  const progress = Math.min(1, state.fade / fadeSeconds);
  // Smoothstep matches the ease of a mixer cross-fade closely enough.
  const eased = progress * progress * (3 - 2 * progress);
  return { rowA, rowB: crowdFrameRow(previous, state.previousTime, CROWD_FPS), blend: 1 - eased };
}

/** Time scale a locomotion clip needs so its stride matches the body speed:
 * `speed / (natural clip speed × render scale)`, the same rule the mixers use. */
export function crowdGaitTimeScale(clip: CrowdClipName, speed: number, naturalSpeed: number | undefined, rootScale: number) {
  if (!naturalSpeed || naturalSpeed <= 0 || !CYCLIC_GAITS.has(clip)) return 1;
  const floor = naturalSpeed * Math.max(1e-5, rootScale);
  return Math.min(CROWD_TIME_SCALE_RANGE.max, Math.max(CROWD_TIME_SCALE_RANGE.min, speed / floor));
}
