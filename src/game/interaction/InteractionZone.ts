export type ActorMask = "player" | "customer" | "employee";
export type InteractionChannel = "passive" | "transfer" | "hands";

export interface InteractionZoneConfig {
  id: string;
  type: string;
  x: number;
  z: number;
  /** Optional fixture footprint. Radii expand outwards from all four sides. */
  halfExtents?: readonly [number, number];
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

export type InteractionZoneSensorPrimitive =
  | { kind: "box"; halfX: number; halfZ: number }
  | { kind: "circle"; offsetX: number; offsetZ: number; radius: number };

export function interactionZonePlanarDistance(
  config: Pick<InteractionZoneConfig, "x" | "z" | "halfExtents">,
  x: number,
  z: number,
) {
  const halfX = Math.max(0, config.halfExtents?.[0] ?? 0);
  const halfZ = Math.max(0, config.halfExtents?.[1] ?? 0);
  const outsideX = Math.max(0, Math.abs(x - config.x) - halfX);
  const outsideZ = Math.max(0, Math.abs(z - config.z) - halfZ);
  return Math.hypot(outsideX, outsideZ);
}

/** Exact compound representation of a rounded rectangle in the XZ plane. */
export function interactionZoneSensorPrimitives(
  config: Pick<InteractionZoneConfig, "halfExtents" | "enterRadius">,
): InteractionZoneSensorPrimitive[] {
  const halfX = Math.max(0, config.halfExtents?.[0] ?? 0);
  const halfZ = Math.max(0, config.halfExtents?.[1] ?? 0);
  const radius = Math.max(0, config.enterRadius);
  if (halfX === 0 && halfZ === 0) return [{ kind: "circle", offsetX: 0, offsetZ: 0, radius }];
  return [
    { kind: "box", halfX: halfX + radius, halfZ },
    { kind: "box", halfX, halfZ: halfZ + radius },
    ...([-1, 1] as const).flatMap((sideX) => ([-1, 1] as const).map((sideZ) => ({
      kind: "circle" as const,
      offsetX: sideX * halfX,
      offsetZ: sideZ * halfZ,
      radius,
    }))),
  ];
}

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
    const distance = interactionZonePlanarDistance(this.config, x, z);
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
