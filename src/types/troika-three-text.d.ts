declare module "troika-three-text" {
  import { Mesh } from "three";

  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    fontWeight: number | "normal" | "bold";
    fontStyle: "normal" | "italic";
    color: string | number;
    anchorX: number | "left" | "center" | "right";
    anchorY: number | "top" | "top-baseline" | "top-cap" | "top-ex" | "middle" | "bottom-baseline" | "bottom";
    maxWidth: number;
    lineHeight: number | "normal";
    letterSpacing: number;
    textAlign: "left" | "right" | "center" | "justify";
    whiteSpace: "normal" | "nowrap";
    overflowWrap: "normal" | "break-word";
    outlineWidth: number | string;
    outlineColor: string | number;
    outlineOpacity: number;
    sync(callback?: () => void): void;
    dispose(): void;
  }
}
