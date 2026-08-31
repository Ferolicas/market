export interface FixedStepStats {
  steps: number;
  alpha: number;
  droppedSeconds: number;
}

export class FixedStepLoop {
  readonly stepSeconds: number;
  readonly maxSubSteps: number;
  private accumulator = 0;
  private lastTimeSeconds: number | null = null;
  private droppedSeconds = 0;

  constructor(stepSeconds = 1 / 60, maxSubSteps = 5) {
    if (!(stepSeconds > 0)) throw new Error("stepSeconds must be positive");
    if (!Number.isInteger(maxSubSteps) || maxSubSteps < 1) throw new Error("maxSubSteps must be a positive integer");
    this.stepSeconds = stepSeconds;
    this.maxSubSteps = maxSubSteps;
  }

  reset(nowSeconds?: number) {
    this.accumulator = 0;
    this.lastTimeSeconds = nowSeconds ?? null;
    this.droppedSeconds = 0;
  }

  advance(nowSeconds: number, tick: (stepSeconds: number) => void): FixedStepStats {
    if (this.lastTimeSeconds === null) {
      this.lastTimeSeconds = nowSeconds;
      return { steps: 0, alpha: 0, droppedSeconds: this.droppedSeconds };
    }
    const elapsed = Math.max(0, nowSeconds - this.lastTimeSeconds);
    this.lastTimeSeconds = nowSeconds;
    const maximumAccepted = this.stepSeconds * this.maxSubSteps;
    if (elapsed > maximumAccepted) this.droppedSeconds += elapsed - maximumAccepted;
    this.accumulator += Math.min(elapsed, maximumAccepted);

    let steps = 0;
    while (this.accumulator + Number.EPSILON >= this.stepSeconds && steps < this.maxSubSteps) {
      tick(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
      steps += 1;
    }
    return {
      steps,
      alpha: Math.min(1, Math.max(0, this.accumulator / this.stepSeconds)),
      droppedSeconds: this.droppedSeconds,
    };
  }
}
