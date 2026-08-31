export interface GazePose { yaw: number; pitch: number; }

export class GazeController {
  constructor(private readonly seed: number) {}

  sample(elapsed: number, mode: "forward" | "browse" | "queue" | "phone" | "checkout"): GazePose {
    const phase = elapsed * (0.42 + (this.seed % 7) * 0.017) + this.seed * 0.73;
    const scale = mode === "browse" ? 0.24 : mode === "queue" ? 0.18 : mode === "checkout" ? 0.1 : 0.055;
    const yaw = Math.max(-0.35, Math.min(0.35, Math.sin(phase) * scale));
    const pitchTarget = mode === "phone" ? 0.22 : mode === "browse" ? 0.06 : mode === "checkout" ? 0.08 : 0;
    return { yaw, pitch: Math.max(-0.18, Math.min(0.28, pitchTarget + Math.sin(phase * 0.61) * 0.025)) };
  }
}
