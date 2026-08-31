export interface WorkstationSnapshot {
  zoneId: string | null;
  locked: boolean;
  waitingForNeutral: boolean;
  cancelledUntilExit: boolean;
}

/**
 * Separates locomotion from stationary work. Entering a workstation consumes
 * the movement that brought the player there; after the input returns to
 * neutral, a new deliberate movement cancels the activity and lets them exit.
 */
export class WorkstationController {
  private zoneId: string | null = null;
  private waitingForNeutral = false;
  private cancelledUntilExit = false;

  sync(zoneId: string | null, inputMagnitude: number) {
    if (zoneId === this.zoneId) return;
    this.zoneId = zoneId;
    this.cancelledUntilExit = false;
    this.waitingForNeutral = zoneId !== null && inputMagnitude > 0.08;
  }

  updateInput(inputMagnitude: number) {
    if (!this.zoneId || this.cancelledUntilExit) return false;
    if (this.waitingForNeutral) {
      if (inputMagnitude <= 0.08) this.waitingForNeutral = false;
      return true;
    }
    if (inputMagnitude >= 0.16) {
      this.cancelledUntilExit = true;
      return false;
    }
    return true;
  }

  canPerform(zoneId: string) {
    return this.zoneId === zoneId && !this.cancelledUntilExit;
  }

  performingZoneId() {
    return this.zoneId && !this.cancelledUntilExit ? this.zoneId : null;
  }

  snapshot(): WorkstationSnapshot {
    return {
      zoneId: this.zoneId,
      locked: this.zoneId !== null && !this.cancelledUntilExit,
      waitingForNeutral: this.waitingForNeutral,
      cancelledUntilExit: this.cancelledUntilExit,
    };
  }
}
