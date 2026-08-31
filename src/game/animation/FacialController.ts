export type FaceExpression = "Neutral" | "Happy" | "Impatient" | "Confused" | "Surprise";

export class FacialController {
  private readonly blinkInterval: number;

  constructor(seed: number) {
    this.blinkInterval = 2.5 + seeded(seed) * 3.5;
  }

  weights(timeSeconds: number, expression: FaceExpression) {
    const blinkDuration = 0.14;
    const blinkPhase = timeSeconds % this.blinkInterval;
    const blink = blinkPhase < blinkDuration ? Math.sin(blinkPhase / blinkDuration * Math.PI) : 0;
    const values: Record<string, number> = { Blink_L: blink, Blink_R: blink };
    if (expression === "Happy") Object.assign(values, { Smile: 0.75, CheekUp: 0.45, BrowUp_L: 0.1, BrowUp_R: 0.1 });
    if (expression === "Impatient") Object.assign(values, { BrowDown_L: 0.35, BrowDown_R: 0.35, Frown: 0.45 });
    if (expression === "Confused") Object.assign(values, { BrowUp_L: 0.45, BrowDown_R: 0.2, MouthNarrow: 0.25, Confused: 0.72 });
    if (expression === "Surprise") Object.assign(values, { EyeWide_L: 0.65, EyeWide_R: 0.65, BrowUp_L: 0.7, BrowUp_R: 0.7, JawOpen: 0.35, Surprise: 0.7 });
    return values;
  }
}

function seeded(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
