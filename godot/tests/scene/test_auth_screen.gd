extends TestCase
var screen: MarketAuthScreen
func before_each() -> void:
	screen = MarketAuthScreen.new()
	Engine.get_main_loop().root.add_child(screen)
func after_each() -> void:
	screen.free()
func test_password_confirmation_rejects_mismatch_before_request() -> void:
	screen._change_mode("reset")
	screen.fields.password.text = "NewPassword-123"
	screen.fields.confirm.text = "Different-12345"
	await screen._submit()
	assert_eq(screen.status.text, "Las contraseñas no coinciden.")
	assert_false(screen.busy)
func test_registration_and_email_validation_match_original_constraints() -> void:
	screen._change_mode("register")
	screen.fields.identity.text = "person@example.invalid"
	screen.fields.password.text = "Password-1234"
	screen.fields.name.text = "Player"
	screen.fields.username.text = "bad user"
	await screen._submit()
	assert_true(screen.status.text.contains("3 a 24"))
	screen._change_mode("forgot")
	screen.fields.identity.text = "invalid email"
	await screen._submit()
	assert_eq(screen.status.text, "Introduce un correo electrónico válido.")
func test_all_modes_fit_small_phone_and_submit_with_keyboard() -> void:
	screen.set_anchors_and_offsets_preset(Control.PRESET_TOP_LEFT)
	for mode in ["login", "register", "forgot", "reset"]:
		screen._change_mode(mode)
		screen.size = Vector2(360, 640)
		screen._reflow()
		for frame in 4: await Engine.get_main_loop().process_frame
		assert_false(screen.hero.visible)
		assert_lte(screen.card.get_global_rect().end.x, 360.0)
		for field in screen.fields.values():
			assert_lte(field.size.x, 320.0)
			assert_eq(field.text_submitted.get_connections().size(), 1)
