import type { Metadata } from "next";
import { RuntimeView } from "../RuntimeView";

export const metadata: Metadata = {
  title: "Runtime por fases — Mini Market",
  description: "El harness de medición fase por fase (base, local horneado, multitud, navmesh, jugador). /runtime ahora es la prueba integral de nivel 30.",
};

export default function RuntimePhasesPage() {
  return <RuntimeView />;
}
