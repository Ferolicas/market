import type { Metadata } from "next";
import { RuntimeView } from "./RuntimeView";

export const metadata: Metadata = {
  title: "Local horneado — Mini Market",
  description: "El runtime con el local estático de nivel 30. La partida sigue en la ruta principal.",
};

export default function RuntimePage() {
  return <RuntimeView />;
}
