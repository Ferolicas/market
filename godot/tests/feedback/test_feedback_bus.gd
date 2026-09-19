extends TestCase

func test_delivers_signals_to_subscribers_until_they_unsubscribe() -> void:
	var bus := FeedbackBus.new()
	var received := []
	var unsubscribe := bus.subscribe(func(signal_value): received.append(signal_value))
	bus.emit("door")
	bus.emit("footstep", { "source": "player", "actorId": "player" })
	unsubscribe.call()
	bus.emit("mission")
	assert_eq(received, [{ "cue": "door", "source": "system" }, { "cue": "footstep", "source": "player", "actorId": "player" }])
	assert_true(is_same(FeedbackBus.shared(), FeedbackBus.shared()))
