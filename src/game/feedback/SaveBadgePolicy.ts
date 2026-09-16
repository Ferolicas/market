export type SaveBadgeStatus = "idle" | "loading" | "dirty" | "saving" | "saved" | "offline" | "conflict" | "error";

export type SaveBadgeTone = "saved" | "dirty" | "saving" | "offline" | "conflict" | "error";

/** The world marks the game dirty ten times a second, so "dirty" alone means
 * nothing to the owner. The badge reads GUARDADO while a confirmed save is
 * this fresh; the autosave runs every 30 s, so anything older is a stall. */
export const SAVE_BADGE_STALE_MS = 90_000;

/**
 * What the HUD badge shows: the internal save status for the degraded states,
 * and otherwise whether the last confirmed save (server acknowledgement or a
 * fresh load) is recent enough to count as saved.
 */
export function saveBadgePresentation(status: SaveBadgeStatus, lastSaveConfirmedAt: number, nowMs: number): { label: string; tone: SaveBadgeTone } {
  if (status === "saving") return { label: "GUARDANDO", tone: "saving" };
  if (status === "offline") return { label: "COPIA LOCAL", tone: "offline" };
  if (status === "conflict") return { label: "CONFLICTO", tone: "conflict" };
  if (status === "error") return { label: "ERROR", tone: "error" };
  const confirmed = Number.isFinite(lastSaveConfirmedAt) && lastSaveConfirmedAt > 0;
  const fresh = confirmed && nowMs - lastSaveConfirmedAt <= SAVE_BADGE_STALE_MS;
  return fresh || status === "saved" ? { label: "GUARDADO", tone: "saved" } : { label: "SIN GUARDAR", tone: "dirty" };
}
