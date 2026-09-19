extends TestCase

func test_gates_repeated_cues_by_channel_cooldown_without_touching_audio_when_effects_are_off() -> void:
	var audio := GameAudio.new({ "music": 0.0, "effects": 0.0, "vibration": false })
	assert_true(audio.play({ "cue": "footstep", "source": "player", "actorId": "player" }))
	assert_false(audio.play({ "cue": "footstep", "source": "player", "actorId": "player" }))
	assert_true(audio.play({ "cue": "footstep", "source": "npc", "actorId": "cashier-1" }))
	assert_true(audio.play({ "cue": "money", "source": "player" }))
	assert_true(audio.play({ "cue": "money", "source": "player" }), "money has no cooldown")
	audio.apply_settings({ "music": 0.0, "effects": 0.5, "vibration": true })
	assert_eq(audio.settings().effects, 0.5)
	assert_false(audio.is_unlocked())
	audio.close()
	audio.free()
