extends TestCase

func _match(actual: Dictionary, expected: Dictionary) -> void:
	for key in expected: assert_eq(actual.get(key), expected[key], key)

func test_asigna_cada_archivo_entregado_a_su_momento_del_juego() -> void:
	assert_eq(SoundDesign.cue_playback({ "cue": "mission", "source": "system" }).sample, "mission")
	assert_eq(SoundDesign.cue_playback({ "cue": "payment", "source": "system" }).sample, "cashier")
	assert_eq(SoundDesign.cue_playback({ "cue": "upgrade", "source": "system" }).sample, "cashier")
	_match(SoundDesign.cue_playback({ "cue": "money", "source": "player" }), { "sample": "money", "loop": true })
	assert_eq(SoundDesign.cue_playback({ "cue": "stock", "source": "player" }).sample, "stock")
	assert_eq(SoundDesign.cue_playback({ "cue": "machine", "source": "player" }).sample, "machine")
	assert_eq(SoundDesign.cue_playback({ "cue": "pickup", "source": "player" }).sample, "machine")

func test_alterna_dos_pisadas_con_tono_variable_y_deja_a_los_clientes_como_murmullo() -> void:
	var first := SoundDesign.cue_playback({ "cue": "footstep", "source": "player", "actorId": "player" }, func(): return 0.1)
	var second := SoundDesign.cue_playback({ "cue": "footstep", "source": "player", "actorId": "player" }, func(): return 0.9)
	assert_eq(first.sample, "step-1")
	assert_eq(second.sample, "step-2")
	assert_lt(first.rate, second.rate)
	var crowd := SoundDesign.cue_playback({ "cue": "footstep", "source": "npc", "actorId": "customer-3" }, func(): return 0.5)
	assert_lt(crowd.gain, first.gain / 3.0)
	assert_gt(crowd.cooldownMs, first.cooldownMs)

func test_vibra_solo_en_cobros_mejoras_y_misiones() -> void:
	var cues := ["footstep", "harvest", "pickup", "stock", "machine", "scanner", "door", "payment", "upgrade", "mission", "money"]
	var with_vibration := JS.filter(cues, func(cue): return SoundDesign.cue_playback({ "cue": cue, "source": "system" }).vibration != null) if SoundDesign.SOUND_SAMPLE_URLS.size() > 0 else []
	assert_eq(with_vibration, ["payment", "upgrade", "mission"])

func test_sintetiza_escaner_y_puerta_sin_archivo_y_precarga_solo_efectos_cortos() -> void:
	_match(SoundDesign.cue_playback({ "cue": "scanner", "source": "player" }), { "sample": null, "tone": 920 })
	_match(SoundDesign.cue_playback({ "cue": "door", "source": "system" }), { "sample": null, "tone": 230 })
	assert_false(SoundDesign.EFFECT_SAMPLES.has("music"))
	var pattern := RegEx.create_from_string("^/audio/.+\\.mp3$")
	for sample in SoundDesign.EFFECT_SAMPLES:
		assert_not_null(pattern.search(SoundDesign.SOUND_SAMPLE_URLS[sample]), sample)
		assert_true(ResourceLoader.exists(SoundDesign.sample_resource_path(sample)), sample)

func test_aisla_el_enfriamiento_de_pasos_por_actor() -> void:
	var player := SoundDesign.feedback_channel({ "cue": "footstep", "source": "player", "actorId": "player" })
	var cashier := SoundDesign.feedback_channel({ "cue": "footstep", "source": "npc", "actorId": "cashier-1" })
	var stocker := SoundDesign.feedback_channel({ "cue": "footstep", "source": "npc", "actorId": "stocker-1" })
	var distinct := {}
	for channel in [player, cashier, stocker]: distinct[channel] = true
	assert_eq(distinct.size(), 3)

func test_mantiene_estable_un_canal_de_sistema_cuando_no_hay_actor() -> void:
	assert_eq(SoundDesign.feedback_channel({ "cue": "door", "source": "system" }), "door:system:system")
