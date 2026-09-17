import type { FeedbackCue, FeedbackSignal } from "./FeedbackBus";

export type SoundSample = "music" | "music-lite" | "silence" | "mission" | "cashier" | "money" | "step-1" | "step-2" | "stock" | "machine";

export const SOUND_SAMPLE_URLS: Record<SoundSample, string> = {
  music: "/audio/music.mp3",
  /** Mono 22 kHz copy, small enough to decode whole where the element cannot be routed (iOS). */
  "music-lite": "/audio/music-lite.mp3",
  /** One silent second: looping it keeps iOS in a playback session so the mute switch spares the game. */
  silence: "/audio/silence.mp3",
  mission: "/audio/mission-complete.mp3",
  cashier: "/audio/cashier.mp3",
  money: "/audio/money-counter.mp3",
  "step-1": "/audio/step-1.mp3",
  "step-2": "/audio/step-2.mp3",
  stock: "/audio/stock.mp3",
  machine: "/audio/machine.mp3",
};

/** Short samples decoded once after the first gesture so no cue waits for the network. */
export const EFFECT_SAMPLES: SoundSample[] = ["mission", "cashier", "money", "step-1", "step-2", "stock", "machine"];

/** The money counter keeps looping while pulses keep landing on a marker and
 * fades this long after the last one. */
export const MONEY_LOOP_HOLD_MS = 650;

export interface CuePlayback {
  /** Decoded sample, or null for a synthesized tone. */
  sample: SoundSample | null;
  /** Tone frequency when no sample carries the cue. */
  tone: number | null;
  gain: number;
  rate: number;
  cooldownMs: number;
  /** Sustained loop (money counter) instead of a one-shot. */
  loop: boolean;
  vibration: number[] | null;
}

interface CueDesign extends Omit<CuePlayback, "rate"> { rate: [number, number] }

const DESIGN: Record<FeedbackCue, CueDesign> = {
  footstep: { sample: "step-1", tone: null, gain: 0.5, rate: [0.9, 1.1], cooldownMs: 95, loop: false, vibration: null },
  harvest: { sample: "stock", tone: null, gain: 0.4, rate: [1.3, 1.45], cooldownMs: 120, loop: false, vibration: null },
  pickup: { sample: "machine", tone: null, gain: 0.55, rate: [1.05, 1.15], cooldownMs: 180, loop: false, vibration: null },
  stock: { sample: "stock", tone: null, gain: 0.7, rate: [0.95, 1.05], cooldownMs: 110, loop: false, vibration: null },
  machine: { sample: "machine", tone: null, gain: 0.8, rate: [0.97, 1.03], cooldownMs: 180, loop: false, vibration: null },
  scanner: { sample: null, tone: 920, gain: 0.25, rate: [1, 1], cooldownMs: 120, loop: false, vibration: null },
  door: { sample: null, tone: 230, gain: 0.2, rate: [1, 1], cooldownMs: 400, loop: false, vibration: null },
  payment: { sample: "cashier", tone: null, gain: 0.9, rate: [1, 1], cooldownMs: 350, loop: false, vibration: [30] },
  upgrade: { sample: "cashier", tone: null, gain: 0.9, rate: [1, 1], cooldownMs: 300, loop: false, vibration: [40, 40, 40] },
  mission: { sample: "mission", tone: null, gain: 1, rate: [1, 1], cooldownMs: 1_000, loop: false, vibration: [70, 50, 140] },
  money: { sample: "money", tone: null, gain: 0.65, rate: [1, 1], cooldownMs: 0, loop: true, vibration: null },
};

/** Footsteps of the crowd stay a murmur under the owner's own steps. */
const NPC_FOOTSTEP_GAIN = 0.22;
const NPC_FOOTSTEP_COOLDOWN_MS = 140;

export function cuePlayback(signal: FeedbackSignal, random: () => number = Math.random): CuePlayback {
  const design = DESIGN[signal.cue];
  const [low, high] = design.rate;
  const rate = low === high ? low : low + (high - low) * random();
  if (signal.cue === "footstep") {
    const npc = signal.source === "npc";
    return { ...design, sample: random() < 0.5 ? "step-1" : "step-2", rate, gain: npc ? design.gain * NPC_FOOTSTEP_GAIN : design.gain, cooldownMs: npc ? NPC_FOOTSTEP_COOLDOWN_MS : design.cooldownMs };
  }
  return { ...design, rate };
}

export function feedbackChannel(signal: FeedbackSignal) {
  return `${signal.cue}:${signal.source}:${signal.actorId ?? signal.source}`;
}
