"use client";

import { useEffect } from "react";
import { reportClientTelemetry } from "@/lib/client-telemetry";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    void reportClientTelemetry({ kind: "error", name: "global-boundary", severity: "error", message: error.message, payload: { digest: error.digest ?? null } }, true);
  }, [error]);
  return <html lang="es"><body style={{ margin: 0 }}><main style={fallbackStyle}><title>Recuperando Mini Market</title><div style={cardStyle}><span style={{ fontSize: 52 }}>🛠️</span><h1>Estamos recuperando tu mercado</h1><p>La copia local de tu partida no se ha eliminado.</p><button style={buttonStyle} onClick={() => retry()}>Reintentar</button></div></main></body></html>;
}

const fallbackStyle = { minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, color: "#173f35", background: "#e8f5ec", fontFamily: "system-ui,sans-serif" };
const cardStyle = { maxWidth: 480, padding: 32, borderRadius: 24, background: "white", boxShadow: "0 18px 60px #173f3530", textAlign: "center" as const };
const buttonStyle = { border: 0, borderRadius: 14, padding: "14px 20px", background: "#1f765f", color: "white", fontWeight: 800, cursor: "pointer" };
