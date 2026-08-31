export type ActorMask = "player" | "customer" | "employee";
export type InteractionChannel = "passive" | "transfer" | "hands";

export interface InteractionZoneConfig {
  id: string;
  type: string;
  x: number;
  z: number;
  enterRadius: number;
  exitRadius: number;
  actorMask: readonly ActorMask[];
  priority: number;
  dwellMs: number;
  repeatEveryMs: number;
  exitGraceMs?: number;
  channel: InteractionChannel;
}

export type ZoneSignal = "enter" | "tick" | "exit";

export interface ZoneEvent { zone: InteractionZoneConfig; signal: ZoneSignal; }

export class InteractionZoneState {
  readonly config: InteractionZoneConfig;
  private inside = false;
  private enteredAt = 0;
  private lastTriggerAt = Number.NEGATIVE_INFINITY;
  private outsideSince: number | null = null;

  constructor(config: InteractionZoneConfig) { this.config = config; }
  get active() { return this.inside; }

  update(actor: ActorMask, x: number, z: number, nowMs: number): ZoneEvent[] {
    if (!this.config.actorMask.includes(actor)) return [];
    const distance = Math.hypot(x - this.config.x, z - this.config.z);
    const within = distance <= (this.inside ? this.config.exitRadius : this.config.enterRadius);
    const events: ZoneEvent[] = [];
    if (within) {
      this.outsideSince = null;
      if (!this.inside) {
        this.inside = true;
        this.enteredAt = nowMs;
        this.lastTriggerAt = Number.NEGATIVE_INFINITY;
        events.push({ zone: this.config, signal: "enter" });
      }
      const dwellReady = nowMs - this.enteredAt >= this.config.dwellMs;
      const cadenceReady = nowMs - this.lastTriggerAt >= this.config.repeatEveryMs;
      if (dwellReady && cadenceReady) {
        this.lastTriggerAt = nowMs;
        events.push({ zone: this.config, signal: "tick" });
      }
      return events;
    }
    if (!this.inside) return events;
    this.outsideSince ??= nowMs;
    if (nowMs - this.outsideSince >= (this.config.exitGraceMs ?? 120)) {
      this.inside = false;
      this.outsideSince = null;
      events.push({ zone: this.config, signal: "exit" });
    }
    return events;
  }
}
