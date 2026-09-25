/**
 * Shared contract between the crowd animation bake (scripts/build-crowd-
 * animations.mts) and the crowd renderer: where the textures live, how they
 * are laid out and which clips they carry.
 */
/** The delivered clips are keyed at 15 Hz; the shader blends consecutive rows,
 * so baking faster would only interpolate what the shader interpolates. */
export const CROWD_FPS = 15;
/** Three RGBA texels hold the 3×4 skin matrix of one bone. */
export const CROWD_TEXELS_PER_BONE = 3;
/** Widest texture a body may need: 41–49 bones × 3 texels, padded to a
 * multiple of four; the manifest carries each body's actual width. */
export const CROWD_TEXTURE_WIDTH = 256;

/** Every clip a customer or an employee can be asked to play. The owner keeps
 * the full rig, so the rest of the delivered clips stay out of the texture. */
export const CROWD_CLIP_NAMES = [
  // Shared locomotion and turns (TurnLeft/TurnRight alias Walk at runtime).
  "Idle", "Walk", "Run", "TurnLeft", "TurnRight", "CarryIdle", "CarryWalk", "CarryRun",
  // Customers.
  "Enter", "Exit", "Wait", "Browse", "ReachShelf", "CarryBasket", "BasketWalk", "Queue", "LookAround", "Phone", "Impatient", "Talk", "CheckoutItem", "Pay", "ReceiveBag", "Confused", "Happy",
  // Employees.
  "Wave", "ReceiveOrder", "LiftBox", "CarryBox", "PickupLow", "StockLow", "StockHigh", "ScanItem", "Plant", "Harvest",
] as const;
export type CrowdClipName = (typeof CROWD_CLIP_NAMES)[number];

export interface CrowdClipRange {
  /** First texture row of the clip. */
  start: number;
  /** Rows the clip spans, including the closing frame at `duration`. */
  frames: number;
  duration: number;
}

export interface CrowdAnimationManifest {
  body: string;
  /** Rows are little-endian IEEE half floats, RGBA per texel. */
  format: "half";
  fps: number;
  width: number;
  frames: number;
  texelsPerBone: number;
  bones: string[];
  clips: Partial<Record<CrowdClipName, CrowdClipRange>>;
  /** Bone indices of the sockets accessories and props hang from. */
  joints: Partial<Record<"Head" | "Hand_L" | "Hand_R" | "Hips", number>>;
  /** Bind matrices (inverse of the inverse-bind) of those joints, column
   * major: `skin × bind` gives the joint's world matrix in rig space. */
  socketBind: Partial<Record<"Head" | "Hand_L" | "Hand_R" | "Hips", number[]>>;
}

export function crowdAnimationPaths(bodyKey: string) {
  return { data: `/models/market/crowd/${bodyKey}.anim.bin`, manifest: `/models/market/crowd/${bodyKey}.anim.json` };
}

/** Fractional texture row for a clip at a time, looping: the integer part is
 * the row, the fraction the blend towards the next row (the clip's closing
 * row equals its first, so the wrap blends cleanly). */
export function crowdFrameRow(clip: CrowdClipRange, timeSeconds: number, fps = CROWD_FPS) {
  const duration = Math.max(1 / fps, clip.duration);
  const wrapped = ((timeSeconds % duration) + duration) % duration;
  return clip.start + Math.min(clip.frames - 1.0001, wrapped * fps);
}
