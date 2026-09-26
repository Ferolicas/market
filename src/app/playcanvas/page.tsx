import type { Metadata } from "next";
import { PlayCanvasIntegralClient } from "./PlayCanvasIntegralClient";

export const metadata: Metadata = {
  title: "PlayCanvas — Mini Market (Fase 1)",
  description: "Cimiento del motor PlayCanvas y la carcasa estructural (suelo, muros, perímetro urbano) sobre el nivel 30 sembrado localmente. No toca /, /play2 ni /runtime.",
};

export default function PlayCanvasPage() {
  return <PlayCanvasIntegralClient />;
}
