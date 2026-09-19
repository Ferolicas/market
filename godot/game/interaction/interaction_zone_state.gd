class_name InteractionZoneState
extends RefCounted
## Port of the `InteractionZoneState` class from src/game/interaction/InteractionZone.ts.
## Tracks one magnet's enter/tick/exit lifecycle for one actor kind.

var config: Dictionary
var _inside := false
var _entered_at: float = 0.0
var _last_trigger_at: float = -INF
var _outside_since: Variant = null

var active: bool:
	get: return _inside

func _init(zone_config: Dictionary) -> void:
	config = zone_config

## Returns the zone events raised by this sample: [] or a list of
## { "zone": config, "signal": "enter"|"tick"|"exit" }.
func update(actor: String, x: float, z: float, now_ms: float) -> Array:
	if not (config.actorMask as Array).has(actor): return []
	var distance := InteractionZone.interaction_zone_planar_distance(config, x, z)
	var within := distance <= float(config.exitRadius if _inside else config.enterRadius)
	var events := []
	if within:
		_outside_since = null
		if not _inside:
			_inside = true
			_entered_at = now_ms
			_last_trigger_at = -INF
			events.append({ "zone": config, "signal": "enter" })
		var dwell_ready := now_ms - _entered_at >= float(config.dwellMs)
		var cadence_ready := now_ms - _last_trigger_at >= float(config.repeatEveryMs)
		if dwell_ready and cadence_ready:
			_last_trigger_at = now_ms
			events.append({ "zone": config, "signal": "tick" })
		return events
	if not _inside: return events
	if _outside_since == null: _outside_since = now_ms
	if now_ms - float(_outside_since) >= float(JS.get_or(config, "exitGraceMs", 120)):
		_inside = false
		_outside_since = null
		events.append({ "zone": config, "signal": "exit" })
	return events
