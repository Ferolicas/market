import type { Metadata } from "next";
import { RuntimeView } from "./RuntimeView";

export const metadata: Metadata = {
  title: "Runtime base — Mini Market",
  description: "Escena mínima del runtime nuevo. La partida sigue en la ruta principal.",
};

export default function RuntimePage() {
  return <RuntimeView />;
}
