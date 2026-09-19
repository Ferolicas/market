class_name InteractionDirector
extends RefCounted
## Port of src/game/interaction/InteractionDirector.ts. Owns every zone of an
## actor, selects one tick per channel (closest target, then priority) and
## orders the emitted events by zone priority.

var _zones: Array = []
var _selected_active_ids: Array = []

func _init(configs: Array) -> void:
	for config in configs:
		_zones.append(InteractionZoneState.new(config))

func update(actor: String, x: float, z: float, now_ms: float) -> Array:
	var events := []
	for zone in _zones:
		events.append_array(zone.update(actor, x, z, now_ms))
	var lifecycle := JS.filter(events, func(event): return event["signal"] != "tick")
	var ticks := JS.filter(events, func(event): return event["signal"] == "tick")
	var selected := {}
	for event in ticks:
		var channel: String = event.zone.channel
		var previous = selected.get(channel)
		if previous == null or _compare_zone_targets(event.zone, previous.zone, x, z) < 0:
			selected[channel] = event
	var active_by_channel := {}
	for zone in _zones:
		if not zone.active: continue
		var channel: String = zone.config.channel
		var previous = active_by_channel.get(channel)
		if previous == null or _compare_zone_targets(zone.config, previous, x, z) < 0:
			active_by_channel[channel] = zone.config
	var by_priority := JS.stable_sort(active_by_channel.values(), func(a, b): return b.priority - a.priority)
	_selected_active_ids = JS.map(by_priority, func(zone): return zone.id)
	return JS.stable_sort(lifecycle + selected.values(), func(a, b): return b.zone.priority - a.zone.priority)

func active_zone_ids() -> Array:
	var ids := []
	for zone in _zones:
		if zone.active: ids.append(zone.config.id)
	return ids

func selected_zone_ids() -> Array:
	return _selected_active_ids

static func _compare_zone_targets(first: Dictionary, second: Dictionary, x: float, z: float) -> float:
	var planar := InteractionZone.interaction_zone_planar_distance(first, x, z) - InteractionZone.interaction_zone_planar_distance(second, x, z)
	if absf(planar) > 0.001: return planar
	var center := JS.hypot(x - first.x, z - first.z) - JS.hypot(x - second.x, z - second.z)
	if absf(center) > 0.001: return center
	return float(second.priority - first.priority)
