extends TestCase

func test_usa_los_valores_por_defecto_cuando_no_hay_nada_guardado_o_esta_corrupto() -> void:
	assert_eq(AudioSettings.parse_audio_settings(null), AudioSettings.DEFAULT_AUDIO_SETTINGS)
	assert_eq(AudioSettings.parse_audio_settings("{not json"), AudioSettings.DEFAULT_AUDIO_SETTINGS)
	assert_eq(AudioSettings.parse_audio_settings("[1,2]"), AudioSettings.DEFAULT_AUDIO_SETTINGS)

func test_recorta_los_volumenes_a_0_1_y_conserva_la_vibracion_solo_si_es_booleana() -> void:
	assert_eq(AudioSettings.normalize_audio_settings({ "music": 1.7, "effects": -3, "vibration": "yes" }), { "music": 1.0, "effects": 0.0, "vibration": true })
	assert_eq(AudioSettings.normalize_audio_settings({ "music": "0.25", "effects": NAN, "vibration": false }), { "music": 0.25, "effects": AudioSettings.DEFAULT_AUDIO_SETTINGS.effects, "vibration": false })

func test_sobrevive_a_un_viaje_por_localstorage() -> void:
	var stored := AudioSettings.serialize_audio_settings({ "music": 0.333, "effects": 0, "vibration": false })
	assert_eq(AudioSettings.parse_audio_settings(stored), { "music": 0.33, "effects": 0.0, "vibration": false })

func test_convierte_el_deslizador_en_ganancia_perceptual() -> void:
	assert_eq(AudioSettings.volume_gain(1), 1.0)
	assert_eq(AudioSettings.volume_gain(0.5), 0.25)
	assert_eq(AudioSettings.volume_gain(0), 0.0)
	assert_eq(AudioSettings.volume_gain(NAN), 0.0)
