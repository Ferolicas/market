extends TestCase
## Port of src/game/interaction/InteractionDirector.test.ts

func _zone(id: String, priority: int, channel: String = "transfer") -> Dictionary:
	return {
		"id": id, "type": id, "x": 0, "z": 0, "enterRadius": 0.75, "exitRadius": 0.9, "actorMask": ["player"], "priority": priority, "dwellMs": 80, "repeatEveryMs": 180, "exitGraceMs": 120, "channel": channel,
	}

func _ticks(events: Array) -> Array:
	return JS.filter(events, func(event): return event["signal"] == "tick")

func _exits(events: Array) -> Array:
	return JS.filter(events, func(event): return event["signal"] == "exit")

func test_uses_dwell_cadence_hysteresis_and_channel_priority() -> void:
	var director := InteractionDirector.new([_zone("near", 2), _zone("priority", 8)])
	assert_eq(_ticks(director.update("player", 0, 0, 0)).size(), 0)
	assert_eq(JS.map(_ticks(director.update("player", 0, 0, 80)), func(event): return event.zone.id), ["priority"])
	assert_eq(_ticks(director.update("player", 0, 0, 100)).size(), 0)
	assert_false(JS.some(director.update("player", 0.8, 0, 150), func(event): return event["signal"] == "exit"))
	assert_eq(_exits(director.update("player", 1, 0, 280)).size(), 0)
	assert_eq(_exits(director.update("player", 1, 0, 400)).size(), 2)

func test_selects_the_closest_active_target_before_using_priority_as_a_tie_breaker() -> void:
	var near := JS.spread(_zone("near", 2), { "x": 0, "z": 0 })
	var farther_priority := JS.spread(_zone("priority", 80), { "x": 0.8, "z": 0 })
	var director := InteractionDirector.new([near, farther_priority])

	director.update("player", 0.1, 0, 0)
	var ticks := _ticks(director.update("player", 0.1, 0, 80))

	assert_eq(JS.map(ticks, func(event): return event.zone.id), ["near"])
	assert_eq(director.selected_zone_ids(), ["near"])
