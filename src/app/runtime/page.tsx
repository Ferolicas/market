import type { Metadata } from "next";
import { IntegralClient } from "./IntegralClient";

export const metadata: Metadata = {
  title: "Nivel 30 integral — Mini Market",
  description: "Prueba integral del nivel 30 completo sobre la arquitectura plain-three (la misma de /play2), sembrada localmente, sin tocar la partida real. El harness por fases sigue en /runtime/phases.",
};

export default function RuntimePage() {
  return <IntegralClient />;
}
