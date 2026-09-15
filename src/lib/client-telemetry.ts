"use client";

import { gameDeviceId, gameSessionId } from "@/game/persistence/ClientIdentity";

export type ClientTelemetryInput = {
  kind: "error" | "performance" | "webgl" | "save";
  name: string;
  severity?: "info" | "warning" | "error";
  message?: string;
  payload?: Record<string, string | number | boolean | null>;
};

export function reportClientTelemetry(input: ClientTelemetryInput, keepalive = false) {
  if (typeof window === "undefined") return Promise.resolve();
  const body = JSON.stringify({
    ...input,
    message: input.message?.slice(0, 1_000),
    route: `${window.location.pathname}${window.location.search}`.slice(0, 300),
    deviceId: gameDeviceId(),
    sessionId: gameSessionId(),
  });
  return fetch("/api/game/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive,
  }).then(() => undefined).catch(() => undefined);
}
