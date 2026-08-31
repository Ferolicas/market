import { InteractionZoneState, type ActorMask, type InteractionChannel, type InteractionZoneConfig, type ZoneEvent } from "./InteractionZone";

export class InteractionDirector {
  private readonly zones: InteractionZoneState[];

  constructor(configs: readonly InteractionZoneConfig[]) {
    this.zones = configs.map((config) => new InteractionZoneState(config));
  }

  update(actor: ActorMask, x: number, z: number, nowMs: number): ZoneEvent[] {
    const events = this.zones.flatMap((zone) => zone.update(actor, x, z, nowMs));
    const lifecycle = events.filter((event) => event.signal !== "tick");
    const ticks = events.filter((event) => event.signal === "tick");
    const selected = new Map<InteractionChannel, ZoneEvent>();
    for (const event of ticks) {
      const previous = selected.get(event.zone.channel);
      if (!previous || event.zone.priority > previous.zone.priority) selected.set(event.zone.channel, event);
    }
    return [...lifecycle, ...selected.values()].sort((a, b) => b.zone.priority - a.zone.priority);
  }

  activeZoneIds() { return this.zones.filter((zone) => zone.active).map((zone) => zone.config.id); }
}
