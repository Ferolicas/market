import { RUNTIME_CONTRACT } from "./contract";

/** Packed pose: x, z, yaw. The renderer lerps this; it does not integrate motion. */
export const POSE_STRIDE = 3;

export function createPoseBuffer(actorCount: number = RUNTIME_CONTRACT.placeholderActors) {
  return new Float32Array(actorCount * POSE_STRIDE);
}

/** Deterministic stand-in motion so interpolation tests have an oracle. */
export function writePlaceholderPose(target: Float32Array, step: number, actorCount = target.length / POSE_STRIDE) {
  for (let index = 0; index < actorCount; index += 1) {
    const angle = step * 0.35 + index * 0.41;
    const radius = 1.6 + (index % 6) * 0.35;
    const offset = index * POSE_STRIDE;
    target[offset] = Math.cos(angle) * radius;
    target[offset + 1] = Math.sin(angle) * radius;
    target[offset + 2] = angle;
  }
}

export function interpolatePoses(from: Float32Array, to: Float32Array, alpha: number, out: Float32Array) {
  const blend = Math.min(1, Math.max(0, alpha));
  const inverse = 1 - blend;
  for (let index = 0; index < out.length; index += 1) {
    out[index] = from[index] * inverse + to[index] * blend;
  }
  return out;
}

/** Called once per committed 5 Hz tick, right after the new pose is written. */
export type SnapshotStepListener = (pose: Float32Array, stepIndex: number, currentTimeMs: number) => void;

/**
 * Fixed 5 Hz world clock. `advance` may run inside the only animation frame.
 * It keeps the last two poses and exposes how far the renderer is between them.
 */
export class SnapshotSimulation {
  readonly previous = createPoseBuffer();
  readonly current = createPoseBuffer();
  readonly interpolated = createPoseBuffer();
  previousTimeMs = 0;
  currentTimeMs = 0;
  private accumulatorMs = 0;
  private stepIndex = 0;

  constructor(actorCount = RUNTIME_CONTRACT.placeholderActors, private readonly onStep?: SnapshotStepListener) {
    if (actorCount !== RUNTIME_CONTRACT.placeholderActors) {
      throw new Error(`The base scene is fixed at ${RUNTIME_CONTRACT.placeholderActors} actors.`);
    }
    writePlaceholderPose(this.previous, 0);
    writePlaceholderPose(this.current, 0);
  }

  /** Advances the world by one frame of real time and writes the in-between pose. */
  sample(deltaMs: number, out = this.interpolated) {
    const safeDelta = Math.min(1_000, Math.max(0, deltaMs));
    this.accumulatorMs += safeDelta;
    let steps = 0;
    while (this.accumulatorMs >= RUNTIME_CONTRACT.simulationStepMs && steps < 3) {
      this.accumulatorMs -= RUNTIME_CONTRACT.simulationStepMs;
      this.previous.set(this.current);
      this.previousTimeMs = this.currentTimeMs;
      this.stepIndex += 1;
      this.currentTimeMs = this.stepIndex * RUNTIME_CONTRACT.simulationStepMs;
      writePlaceholderPose(this.current, this.stepIndex);
      this.onStep?.(this.current, this.stepIndex, this.currentTimeMs);
      steps += 1;
    }
    if (this.accumulatorMs > RUNTIME_CONTRACT.simulationStepMs * 3) this.accumulatorMs = 0;
    const alpha = this.accumulatorMs / RUNTIME_CONTRACT.simulationStepMs;
    return interpolatePoses(this.previous, this.current, alpha, out);
  }
}
