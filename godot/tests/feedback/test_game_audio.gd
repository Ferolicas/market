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

func test_scanner_generates_real_audio_stream_and_uses_stream_playback() -> void:
	var audio := GameAudio.new({"music": 0.0, "effects": 1.0, "vibration": false})
	Engine.get_main_loop().root.add_child(audio)
	audio.unlock()
	assert_true(audio.play({"cue": "scanner", "source": "player", "actorId": "player"}))
	assert_not_null(audio._tone_player)
	assert_true(audio._tone_player.playing)
	assert_eq(audio._tone_player.playback_type, AudioServer.PLAYBACK_TYPE_STREAM)
	assert_true(audio._tone_player.get_stream_playback() is AudioStreamGeneratorPlayback)
	assert_gt(audio._tone_player.get_stream_playback().get_frames_available(), 0)
	audio.close()
	audio.free()

func test_scanner_mixer_contains_non_silent_pcm_not_just_a_playing_flag() -> void:
	var bus := AudioServer.get_bus_index("Effects")
	var capture := AudioEffectCapture.new()
	var index := AudioServer.get_bus_effect_count(bus)
	AudioServer.add_bus_effect(bus, capture)
	var audio := GameAudio.new({"music": 0.0, "effects": 1.0, "vibration": false})
	Engine.get_main_loop().root.add_child(audio)
	audio.unlock()
	audio.play({"cue": "scanner", "source": "player", "actorId": "player"})
	await Engine.get_main_loop().create_timer(0.25).timeout
	var samples := capture.get_buffer(capture.get_frames_available())
	assert_gt(samples.size(), 0)
	var peak := 0.0
	for sample in samples: peak = maxf(peak, absf(sample.x))
	assert_gt(peak, 0.001, "Actual scanner PCM must reach the effects bus")
	audio.close()
	audio.free()
	AudioServer.remove_bus_effect(bus, index)
