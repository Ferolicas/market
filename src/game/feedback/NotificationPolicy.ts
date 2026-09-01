export type NotificationSaveStatus = "idle" | "loading" | "dirty" | "saving" | "saved" | "offline" | "conflict" | "error";

export type NotificationPresentation = {
  message: string;
  tone: "info" | "warning" | "danger";
  lifecycle: "transient" | "persistent";
  durationMs: number | null;
};

export const TRANSIENT_NOTIFICATION_DURATION_MS = 3_000;

const SILENT_SAVE_MESSAGES = new Set([
  "Partida guardada",
  "Progreso sincronizado",
]);

/**
 * Keeps save/game state authoritative while deciding only how long its visual
 * feedback belongs on screen. Ongoing degraded states stay visible; routine
 * confirmations and gameplay feedback leave the mobile viewport promptly.
 */
export function notificationPresentation(
  message: string,
  saveStatus: NotificationSaveStatus,
): NotificationPresentation | null {
  const normalizedMessage = message.trim();
  if (!normalizedMessage || SILENT_SAVE_MESSAGES.has(normalizedMessage)) return null;

  if (saveStatus === "error" || saveStatus === "conflict") {
    return {
      message: normalizedMessage,
      tone: "danger",
      lifecycle: "persistent",
      durationMs: null,
    };
  }

  if (saveStatus === "offline") {
    return {
      message: normalizedMessage,
      tone: "warning",
      lifecycle: "transient",
      durationMs: TRANSIENT_NOTIFICATION_DURATION_MS,
    };
  }

  return {
    message: normalizedMessage,
    tone: "info",
    lifecycle: "transient",
    durationMs: TRANSIENT_NOTIFICATION_DURATION_MS,
  };
}

/** A monotonic occurrence keeps a repeated offline/recovery transition
 * eligible after the previous, text-identical toast has expired. */
export function notificationOccurrenceKey(
  notification: NotificationPresentation | null,
  occurrence: number,
) {
  return notification
    ? `${occurrence}:${notification.tone}:${notification.lifecycle}:${notification.message}`
    : "";
}
