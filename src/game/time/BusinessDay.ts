export const BUSINESS_DAY_OPEN_MINUTE = 7 * 60 + 30;
export const BUSINESS_DAY_DUSK_MINUTE = 18 * 60;
export const BUSINESS_DAY_NIGHT_MINUTE = 21 * 60;
export const BUSINESS_DAY_GAME_MINUTES = BUSINESS_DAY_NIGHT_MINUTE - BUSINESS_DAY_OPEN_MINUTE;
export const BUSINESS_DAY_REAL_DURATION_MS = 3 * 60 * 60 * 1_000;

export function businessMinutesForRealMs(realMs: number) {
  const boundedMs = Number.isFinite(realMs) ? Math.max(0, realMs) : 0;
  return boundedMs * BUSINESS_DAY_GAME_MINUTES / BUSINESS_DAY_REAL_DURATION_MS;
}

export function businessDayIsClosing(minuteOfDay: number) {
  return minuteOfDay >= BUSINESS_DAY_NIGHT_MINUTE;
}

export interface DaylightPresentation {
  background: string;
  fog: string;
  ambientIntensity: number;
  keyIntensity: number;
  keyColor: string;
  phase: "day" | "sunset" | "night";
}

const DAY = { background: "#b8dfce", ambient: 1.15, key: 2.3, keyColor: "#fff6df" } as const;
const SUNSET = { background: "#d69b78", ambient: 0.72, key: 1.45, keyColor: "#ffc18b" } as const;
const NIGHT = { background: "#172942", ambient: 0.34, key: 0.48, keyColor: "#9db9e8" } as const;

export function daylightPresentation(minuteOfDay: number): DaylightPresentation {
  if (minuteOfDay <= BUSINESS_DAY_DUSK_MINUTE) {
    return { background: DAY.background, fog: DAY.background, ambientIntensity: DAY.ambient, keyIntensity: DAY.key, keyColor: DAY.keyColor, phase: "day" };
  }
  if (minuteOfDay >= BUSINESS_DAY_NIGHT_MINUTE) {
    return { background: NIGHT.background, fog: NIGHT.background, ambientIntensity: NIGHT.ambient, keyIntensity: NIGHT.key, keyColor: NIGHT.keyColor, phase: "night" };
  }

  const duskProgress = (minuteOfDay - BUSINESS_DAY_DUSK_MINUTE) / (BUSINESS_DAY_NIGHT_MINUTE - BUSINESS_DAY_DUSK_MINUTE);
  const firstHalf = duskProgress <= 0.5;
  const localProgress = smoothStep(firstHalf ? duskProgress * 2 : (duskProgress - 0.5) * 2);
  const from = firstHalf ? DAY : SUNSET;
  const to = firstHalf ? SUNSET : NIGHT;
  const background = interpolateHex(from.background, to.background, localProgress);
  return {
    background,
    fog: background,
    ambientIntensity: lerp(from.ambient, to.ambient, localProgress),
    keyIntensity: lerp(from.key, to.key, localProgress),
    keyColor: interpolateHex(from.keyColor, to.keyColor, localProgress),
    phase: "sunset",
  };
}

function smoothStep(value: number) {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded * bounded * (3 - 2 * bounded);
}

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function interpolateHex(from: string, to: string, progress: number) {
  const fromValue = Number.parseInt(from.slice(1), 16);
  const toValue = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number) => Math.round(lerp((fromValue >> shift) & 255, (toValue >> shift) & 255, progress));
  return `#${[channel(16), channel(8), channel(0)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
