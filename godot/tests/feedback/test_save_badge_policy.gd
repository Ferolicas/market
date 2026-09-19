extends TestCase

func test_reads_guardado_while_the_last_confirmed_save_is_fresh_even_though_the_world_keeps_marking_the_game_dirty() -> void:
	var confirmed_at := 1000000
	assert_eq(SaveBadgePolicy.save_badge_presentation("dirty", confirmed_at, confirmed_at + 100), { "label": "GUARDADO", "tone": "saved" })
	assert_eq(SaveBadgePolicy.save_badge_presentation("dirty", confirmed_at, confirmed_at + 45000), { "label": "GUARDADO", "tone": "saved" })
	assert_eq(SaveBadgePolicy.save_badge_presentation("saved", confirmed_at, confirmed_at + 100), { "label": "GUARDADO", "tone": "saved" })

func test_reads_sin_guardar_only_once_the_autosave_has_clearly_stalled() -> void:
	var confirmed_at := 1000000
	assert_eq(SaveBadgePolicy.save_badge_presentation("dirty", confirmed_at, confirmed_at + SaveBadgePolicy.SAVE_BADGE_STALE_MS + 1), { "label": "SIN GUARDAR", "tone": "dirty" })
	assert_eq(SaveBadgePolicy.save_badge_presentation("dirty", 0, 5000), { "label": "SIN GUARDAR", "tone": "dirty" })

func test_keeps_the_degraded_states_visible() -> void:
	assert_eq(SaveBadgePolicy.save_badge_presentation("saving", 1, 2).label, "GUARDANDO")
	assert_eq(SaveBadgePolicy.save_badge_presentation("offline", 1, 2).label, "COPIA LOCAL")
	assert_eq(SaveBadgePolicy.save_badge_presentation("conflict", 1, 2).label, "CONFLICTO")
	assert_eq(SaveBadgePolicy.save_badge_presentation("error", 1, 2).label, "ERROR")
