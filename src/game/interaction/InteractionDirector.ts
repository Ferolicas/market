import { interactionZonePlanarDistance, InteractionZoneState, type ActorMask, type InteractionChannel, type InteractionZoneConfig, type ZoneEvent } from "./InteractionZone";

export class InteractionDirector {
  private readonly zones: InteractionZoneState[];
  private selectedActiveIds: string[] = [];

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
      if (!previous || compareZoneTargets(event.zone, previous.zone, x, z) < 0) selected.set(event.zone.channel, event);
    }
    const activeByChannel = new Map<InteractionChannel, InteractionZoneConfig>();
    for (const zone of this.zones.filter((candidate) => candidate.active)) {
      const previous = activeByChannel.get(zone.config.channel);
      if (!previous || compareZoneTargets(zone.config, previous, x, z) < 0) activeByChannel.set(zone.config.channel, zone.config);
    }
    this.selectedActiveIds = [...activeByChannel.values()].sort((a, b) => b.priority - a.priority).map((zone) => zone.id);
    return [...lifecycle, ...selected.values()].sort((a, b) => b.zone.priority - a.zone.priority);
  }

  activeZoneIds() { return this.zones.filter((zone) => zone.active).map((zone) => zone.config.id); }
  selectedZoneIds() { return this.selectedActiveIds; }
}

function compareZoneTargets(first: InteractionZoneConfig, second: InteractionZoneConfig, x: number, z: number) {
  const planar = interactionZonePlanarDistance(first, x, z) - interactionZonePlanarDistance(second, x, z);
  if (Math.abs(planar) > 0.001) return planar;
  const center = Math.hypot(x - first.x, z - first.z) - Math.hypot(x - second.x, z - second.z);
  if (Math.abs(center) > 0.001) return center;
  return second.priority - first.priority;
}
