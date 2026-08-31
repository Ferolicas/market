export class FootGroundingController {
  private soleClearance: number | null = null;

  calibrate(lowestFootWorldY: number, groundWorldY: number) {
    if (this.soleClearance === null && Number.isFinite(lowestFootWorldY)) this.soleClearance = Math.max(0, lowestFootWorldY - groundWorldY);
  }

  solve(lowestFootWorldY: number, groundWorldY: number, supportWeight: number) {
    if (this.soleClearance === null || supportWeight <= 0) return 0;
    const error = groundWorldY + this.soleClearance - lowestFootWorldY;
    return Math.max(-0.03, Math.min(0.03, error * Math.min(1, supportWeight)));
  }

  reset() { this.soleClearance = null; }
}
