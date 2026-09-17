/** Sound preferences live on the device, never in the save: they are not
 * part of the game and the server schema rejects unknown fields. */
export interface AudioSettings {
  /** Background music level, 0..1 as the slider shows it. */
  music: number;
  /** Effects level (steps, shelves, machines, till, missions), 0..1. */
  effects: number;
  vibration: boolean;
}

export const AUDIO_SETTINGS_KEY = "mini-market-audio-v1";
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { music: 0.6, effects: 0.8, vibration: true };

function level(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, Math.round(parsed * 100) / 100)) : fallback;
}

export function normalizeAudioSettings(input: unknown): AudioSettings {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return {
    music: level(raw.music, DEFAULT_AUDIO_SETTINGS.music),
    effects: level(raw.effects, DEFAULT_AUDIO_SETTINGS.effects),
    vibration: typeof raw.vibration === "boolean" ? raw.vibration : DEFAULT_AUDIO_SETTINGS.vibration,
  };
}

export function parseAudioSettings(serialized: string | null | undefined): AudioSettings {
  if (!serialized) return { ...DEFAULT_AUDIO_SETTINGS };
  try { return normalizeAudioSettings(JSON.parse(serialized)); } catch { return { ...DEFAULT_AUDIO_SETTINGS }; }
}

export function serializeAudioSettings(settings: AudioSettings) {
  return JSON.stringify(normalizeAudioSettings(settings));
}

/** Slider position to gain: squared so half way sounds half as loud instead of a quarter. */
export function volumeGain(levelValue: number) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(levelValue) ? levelValue : 0));
  return clamped * clamped;
}
