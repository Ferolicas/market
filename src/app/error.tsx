"use client";

import { useEffect } from "react";
import { reportClientTelemetry } from "@/lib/client-telemetry";

export default function GameError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    void reportClientTelemetry({
      kind: "error",
      name: "game-route-boundary",
      severity: "error",
      message: error.message,
      payload: { digest: error.digest ?? null, stack: error.stack?.slice(0, 500) ?? null },
    }, true);
  }, [error]);

  return <main style={fallbackStyle}><div style={cardStyle}><span style={{ fontSize: 52 }}>🏪</span><h1>La tienda necesita reiniciarse</h1><p>Tu progreso local sigue protegido. Reintentaremos cargar la escena sin borrar la partida.</p><button style={buttonStyle} onClick={() => retry()}>Volver a la tienda</button></div></main>;
}

const fallbackStyle = { minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, color: "#173f35", background: "linear-gradient(145deg,#eff8ef,#d6eee2)", fontFamily: "system-ui,sans-serif" };
const cardStyle = { maxWidth: 480, padding: 32, borderRadius: 24, background: "white", boxShadow: "0 18px 60px #173f3530", textAlign: "center" as const };
const buttonStyle = { border: 0, borderRadius: 14, padding: "14px 20px", background: "#1f765f", color: "white", fontWeight: 800, cursor: "pointer" };
