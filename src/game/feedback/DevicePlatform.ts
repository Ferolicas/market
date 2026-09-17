export interface DeviceHints { userAgent: string; platform: string; maxTouchPoints: number }

/** iPhone and iPad (including iPadOS pretending to be a Mac): Safari's audio
 * rules differ there, whatever browser icon the user tapped. */
export function isAppleTouchDevice(hints: DeviceHints) {
  return /iP(hone|ad|od)/.test(hints.userAgent) || (hints.platform === "MacIntel" && hints.maxTouchPoints > 1);
}

export function currentDeviceHints(): DeviceHints {
  if (typeof navigator === "undefined") return { userAgent: "", platform: "", maxTouchPoints: 0 };
  return { userAgent: navigator.userAgent ?? "", platform: navigator.platform ?? "", maxTouchPoints: navigator.maxTouchPoints ?? 0 };
}
