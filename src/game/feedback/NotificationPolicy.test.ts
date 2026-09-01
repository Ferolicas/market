import { describe, expect, it } from "vitest";
import { notificationOccurrenceKey, notificationPresentation, TRANSIENT_NOTIFICATION_DURATION_MS, type NotificationSaveStatus } from "./NotificationPolicy";

describe("notification presentation policy", () => {
  it.each([
    ["Recuperé cambios locales pendientes", "dirty", "info"],
    ["Guardado parcial; sincronizando cambios nuevos", "dirty", "info"],
    ["Tomates colocados en el expositor", "saving", "info"],
    ["Sin conexión: progreso protegido localmente", "offline", "warning"],
  ] satisfies [string, NotificationSaveStatus, "info" | "warning"][])('%s is transient while its underlying state remains intact', (message, status, tone) => {
    expect(notificationPresentation(message, status)).toEqual({
      message,
      tone,
      lifecycle: "transient",
      durationMs: TRANSIENT_NOTIFICATION_DURATION_MS,
    });
  });

  it.each([
    ["No se pudo cargar la partida", "error", "danger"],
    ["Otra sesión guardó primero", "conflict", "danger"],
  ] satisfies [string, NotificationSaveStatus, "danger"][])('keeps %s persistent', (message, status, tone) => {
    expect(notificationPresentation(message, status)).toEqual({
      message,
      tone,
      lifecycle: "persistent",
      durationMs: null,
    });
  });

  it.each(["", "   ", "Partida guardada", "Progreso sincronizado"])("does not occupy the viewport for routine save feedback: %j", (message) => {
    expect(notificationPresentation(message, "saved")).toBeNull();
  });

  it("gives text-identical degraded transitions a new visual lifecycle", () => {
    const first = notificationPresentation("Sin conexión: los cambios siguen protegidos en este dispositivo", "offline");
    const second = notificationPresentation("Sin conexión: los cambios siguen protegidos en este dispositivo", "offline");
    expect(notificationOccurrenceKey(first, 8)).not.toBe(notificationOccurrenceKey(second, 9));
  });
});
