extends TestCase
var viewport_stub: Control
var hud: MarketHud

func before_each() -> void:
	# hud anchors PRESET_FULL_RECT to whatever it is parented under (matches
	# production, where its parent tracks the real viewport); parenting it
	# under a fixed-size Control of our own, instead of the test runner's
	# actual window, keeps the test's viewport size exactly what it sets.
	viewport_stub = Control.new()
	viewport_stub.size = Vector2(390, 844)
	Engine.get_main_loop().root.add_child(viewport_stub)
	hud = MarketHud.new()
	viewport_stub.add_child(hud)
	hud._layout()

func after_each() -> void:
	viewport_stub.free()

## The user asked for the nav "pegado totalmente al footer" — its own
## background must reach the screen's bottom edge exactly, not float above
## it with a gap, and span the full width like a real footer.
func test_nav_bar_is_flush_with_the_bottom_edge_and_full_width() -> void:
	assert_near(hud.menu.position.y + hud.menu.size.y, hud.size.y, 0.5)
	assert_eq(hud.menu.size.x, hud.size.x)
	assert_eq(hud.menu.position.x, 0.0)

func test_nav_bar_stays_flush_with_a_bottom_safe_area_inset() -> void:
	# A bottom inset (iOS home indicator) must be absorbed as inner padding,
	# not push the bar up and reopen a gap above the footer.
	var style: StyleBoxFlat = hud.menu.get_theme_stylebox("panel")
	style.content_margin_bottom = 34
	hud._layout()
	assert_near(hud.menu.position.y + hud.menu.size.y, hud.size.y, 0.5)

## At the real device's own viewport width (430pt, from production
## telemetry) all seven labels must actually be showing and the bar must
## still be exactly as wide as the screen — no overflow, no clipped labels.
func test_labels_show_and_bar_still_fits_at_the_devices_real_width() -> void:
	viewport_stub.size = Vector2(430, 932)
	hud._layout()
	for id in hud.nav_buttons: assert_ne(hud.nav_buttons[id].text, "", id)
	assert_eq(hud.menu.size.x, 430.0)

## Below the point where seven labeled buttons no longer fit (an iPhone SE
## or narrower), the bar must drop to icon-only rather than overflow its own
## footer.
func test_drops_to_icon_only_on_a_narrow_phone_instead_of_overflowing() -> void:
	viewport_stub.size = Vector2(375, 667)
	hud._layout()
	for id in hud.nav_buttons: assert_eq(hud.nav_buttons[id].text, "", id)
	assert_eq(hud.menu.size.x, 375.0)

## Now that the nav is full-width and flush with the footer, the carry card
## and toast (previously floating independently above the bottom edge) must
## clear the bar's own top edge instead of sitting underneath it.
func test_carry_card_and_toast_clear_the_now_full_width_nav_bar() -> void:
	viewport_stub.size = Vector2(390, 844)
	hud._layout()
	hud.carry_card.visible = true
	hud.toast.text = "Guardado"
	hud._layout()
	assert_lte(hud.carry_card.position.y + hud.carry_card.size.y, hud.menu.position.y + 0.5)
	assert_lte(hud.toast.position.y + hud.toast.size.y, hud.menu.position.y + 0.5)

func test_all_seven_panels_are_reachable_from_the_nav() -> void:
	var requested: Array = []
	hud.panel_requested.connect(func(id): requested.append(id))
	for id in ["stock", "orders", "team", "map", "finance", "avatar", "help"]:
		assert_true(hud.nav_buttons.has(id), id)
		hud.nav_buttons[id].pressed.emit()
	assert_eq(requested, ["stock", "orders", "team", "map", "finance", "avatar", "help"])

func test_set_active_panel_highlights_only_the_matching_button() -> void:
	hud.set_active_panel("team")
	for id in hud.nav_buttons:
		var button: Button = hud.nav_buttons[id]
		var active: bool = id == "team"
		assert_eq(button.get_theme_color("icon_normal_color"), Color(hud.NAV_ACCENT) if active else Color(hud.NAV_ICON_IDLE), id)
	hud.set_active_panel("")
	for id in hud.nav_buttons:
		assert_eq(hud.nav_buttons[id].get_theme_color("icon_normal_color"), Color(hud.NAV_ICON_IDLE), id)
