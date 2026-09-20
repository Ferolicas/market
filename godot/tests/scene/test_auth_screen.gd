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

func test_keyboard_occlusion_keeps_every_field_visible_and_navigable() -> void:
	var window: Window = Engine.get_main_loop().root
	var previous_size := window.size
	screen.set_anchors_and_offsets_preset(Control.PRESET_TOP_LEFT)
	for dimensions in [Vector2(360, 640), Vector2(390, 844), Vector2(430, 932)]:
		window.size = Vector2i(dimensions)
		for frame in 2: await Engine.get_main_loop().process_frame
		for mode in ["login", "register", "forgot", "reset"]:
			screen._change_mode(mode)
			screen.size = dimensions
			screen._apply_keyboard_height(320)
			var items := screen.fields.values()
			items[0].grab_focus()
			for index in items.size():
				for frame in 4: await Engine.get_main_loop().process_frame
				var field: LineEdit = items[index]
				assert_true(field.has_focus())
				assert_true(screen.keyboard_bar.visible)
				assert_lte(screen.scroll.get_global_rect().end.y, dimensions.y - 320 - 56)
				assert_gte(field.get_global_rect().position.y, screen.scroll.get_global_rect().position.y - 1)
				assert_lte(field.get_global_rect().end.y, screen.scroll.get_global_rect().end.y + 1)
				assert_lte(screen.keyboard_bar.get_global_rect().end.y, dimensions.y - 320)
				assert_eq(screen.keyboard_next.disabled, index == items.size() - 1)
				if index + 1 < items.size(): await _tap_button(screen.keyboard_next)
			await _tap_button(screen.keyboard_hide)
			assert_false(screen.keyboard_bar.visible)
			assert_false(items[-1].has_focus())
			assert_near(screen.scroll.size.y, dimensions.y - 40, 0.01)

	window.size = previous_size

func test_return_moves_to_next_field_without_sending_incomplete_form() -> void:
	screen._change_mode("register")
	screen.fields.name.grab_focus()
	screen._submit_or_next()
	assert_true(screen.fields.username.has_focus())
	assert_false(screen.busy)
	assert_eq(screen.status.text, "")
	screen._submit_or_next()
	assert_true(screen.fields.identity.has_focus())
	screen._submit_or_next()
	assert_true(screen.fields.password.has_focus())

func _tap_button(button: Button) -> void:
	var motion := InputEventMouseMotion.new()
	motion.position = button.get_global_rect().get_center()
	motion.global_position = motion.position
	Engine.get_main_loop().root.push_input(motion, true)
	var press := InputEventMouseButton.new()
	press.position = button.get_global_rect().get_center()
	press.global_position = press.position
	press.button_index = MOUSE_BUTTON_LEFT
	press.pressed = true
	Engine.get_main_loop().root.push_input(press, true)
	await Engine.get_main_loop().process_frame
	var release: InputEventMouseButton = press.duplicate()
	release.pressed = false
	Engine.get_main_loop().root.push_input(release, true)
	await Engine.get_main_loop().process_frame
