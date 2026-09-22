class_name MarketHud
extends Control
signal panel_requested(id: String)
signal toggle_requested
signal save_requested
const W = preload("res://game/ui/widgets.gd")
var top: PanelContainer
var menu: PanelContainer
var brand: VBoxContainer
var name_label: Label
var city: Label
var money: Label
var clock_label: Label
var level: Label
var toggle: Button
var save: Button
var sound: Button
var player_card: PanelContainer
var player_label: Label
var reputation: Label
var carry_card: PanelContainer
var carry_label: Label
var carry_title: Label
var toast: Label
var guide: PanelContainer
var guide_button: Button
var guide_detail: Label
var guide_progress: ProgressBar
var nav_buttons: Dictionary = {}
var nav_row: HBoxContainer
var active_panel_id := ""
const NAV_ACCENT := "ef6c4c"
const NAV_ICON_IDLE := "8f8a78"
const NAV_BAR_BG := "fffaf0"
const NAV_LABEL_ES := {"stock": "Inventario", "orders": "Pedidos", "team": "Equipo", "map": "Sucursales", "finance": "Finanzas", "avatar": "Avatar", "help": "Ayuda"}

func _ready() -> void:
	set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	mouse_filter = MOUSE_FILTER_IGNORE
	top = _card(6, 20)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	top.add_child(row)
	brand = VBoxContainer.new()
	brand.custom_minimum_size.x = 150
	row.add_child(brand)
	name_label = W.label(brand, "", 12)
	city = W.label(brand, "", 8)
	money = W.label(row, "", 18)
	money.custom_minimum_size.x = 124
	money.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	clock_label = W.label(row, "", 14)
	clock_label.custom_minimum_size.x = 72
	clock_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	level = W.label(row, "", 14)
	level.custom_minimum_size.x = 72
	level.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	toggle = _button(row, "", "", func(): toggle_requested.emit())
	sound = _button(row, "sound", "Sonido y vibración", func(): panel_requested.emit("settings"))
	save = _button(row, "cloud", "Guardar ahora", func(): save_requested.emit())
	save.name = "SaveGame"
	menu = _nav_bar()
	var menu_center := CenterContainer.new()
	menu.add_child(menu_center)
	nav_row = HBoxContainer.new()
	nav_row.add_theme_constant_override("separation", 0)
	menu_center.add_child(nav_row)
	for entry in [["stock", "inventory"], ["orders", "suppliers"], ["team", "team"], ["map", "map"], ["finance", "finance"], ["avatar", "avatar"], ["help", "help"]]:
		nav_buttons[entry[0]] = _nav_button(nav_row, entry[1], NAV_LABEL_ES[entry[0]], func(): panel_requested.emit(entry[0]))
	player_card = _card(7, 16)
	var player_row := HBoxContainer.new()
	player_card.add_child(player_row)
	var text := VBoxContainer.new()
	player_row.add_child(text)
	player_label = W.label(text, "", 10)
	reputation = W.label(text, "", 8)
	_button(player_row, "cloud", "Guardar ahora", func(): save_requested.emit())
	carry_card = _card(7, 24)
	var carry_text := VBoxContainer.new()
	carry_card.add_child(carry_text)
	carry_title = W.label(carry_text, "", 9)
	carry_label = W.label(carry_text, "", 14)
	toast = W.label(self, "", 12)
	toast.mouse_filter = MOUSE_FILTER_IGNORE
	guide = _card(5, 17)
	var guide_content := VBoxContainer.new()
	guide.add_child(guide_content)
	guide_button = _button(guide_content, "chevron", "Abrir guía", func():
		guide_detail.visible = not guide_detail.visible
		guide.reset_size())
	guide_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	guide_button.add_theme_font_size_override("font_size", 10)
	guide_progress = ProgressBar.new()
	guide_progress.show_percentage = false
	guide_progress.custom_minimum_size.y = 6
	guide_content.add_child(guide_progress)
	guide_detail = W.label(guide_content, "", 10)
	guide_detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	guide_detail.custom_minimum_size.x = 246
	guide_detail.visible = false
	AudioSettingsStore.shared().changed.connect(_audio_settings_changed)
	_audio_settings_changed(AudioSettingsStore.shared().settings())
	resized.connect(_layout)
	_layout.call_deferred()

func _card(padding: int, radius: int) -> PanelContainer:
	var card := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color("fffaf0ee")
	style.border_color = Color("dfd9ca")
	style.set_border_width_all(1)
	style.set_corner_radius_all(radius)
	style.content_margin_left = padding
	style.content_margin_right = padding
	style.content_margin_top = padding
	style.content_margin_bottom = padding
	card.add_theme_stylebox_override("panel", style)
	add_child(card)
	return card

func _button(parent: Node, icon: String, title: String, action: Callable) -> Button:
	var button := Button.new()
	button.tooltip_text = title
	button.custom_minimum_size = Vector2(38, 38)
	button.add_theme_font_size_override("font_size", 9)
	if not icon.is_empty(): button.icon = load("res://assets/ui/%s.svg" % icon)
	for state in ["normal", "hover", "pressed", "disabled"]:
		var style := StyleBoxFlat.new()
		style.bg_color = Color("faf7ef") if state == "normal" else Color("e8ead8")
		style.set_corner_radius_all(12)
		style.content_margin_left = 6
		style.content_margin_right = 6
		button.add_theme_stylebox_override(state, style)
	button.pressed.connect(action)
	parent.add_child(button)
	return button

## Docked flush to the screen's bottom edge (the footer), full width, rounded
## only at the top so it reads as an attached dock rather than a floating
## pill. The lifted-off-the-scene feel a premium tab bar needs comes from a
## soft upward shadow instead of a border, since there is no bottom/side
## border to frame it against the 3D world behind it.
func _nav_bar() -> PanelContainer:
	var bar := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(NAV_BAR_BG)
	style.set_corner_radius_all(0)
	style.corner_radius_top_left = 26
	style.corner_radius_top_right = 26
	style.border_width_top = 1
	style.border_color = Color("efe8d4")
	style.shadow_color = Color(0.11, 0.2, 0.16, 0.16)
	style.shadow_size = 18
	style.shadow_offset = Vector2(0, -4)
	style.content_margin_left = 6
	style.content_margin_right = 6
	style.content_margin_top = 10
	bar.add_theme_stylebox_override("panel", style)
	# A management panel's overlay is a sibling added after `hud`, so by tree
	# order alone it draws (and receives input) above the whole HUD, nav bar
	# included — the player could open a panel and lose all sight of where
	# they were or any way to jump straight to another panel. A higher
	# z_index keeps the dock drawn, and tappable, above that overlay; the
	# overlay/card in game_shell.gd stop short of the bar's own top edge
	# (see its `reflow` closure) so the two never visually fight either.
	bar.z_index = 20
	add_child(bar)
	return bar

## Icon above a micro-label (native tab-bar convention), evenly filling the
## bar's width. The idle/active look is entirely color (icon + label tint
## plus a soft accent pill behind the icon) so it stays true to the same SVG
## glyphs; see set_active_panel().
func _nav_button(parent: Node, icon: String, title: String, action: Callable) -> Button:
	var button := Button.new()
	button.name = "Nav" + icon.capitalize()
	button.tooltip_text = title
	button.text = title
	button.custom_minimum_size = Vector2(0, 56)
	button.size_flags_horizontal = SIZE_EXPAND_FILL
	button.alignment = HORIZONTAL_ALIGNMENT_CENTER
	button.vertical_icon_alignment = VERTICAL_ALIGNMENT_TOP
	button.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	button.expand_icon = false
	button.add_theme_font_size_override("font_size", 9)
	button.add_theme_constant_override("icon_max_width", 22)
	button.add_theme_constant_override("h_separation", 4)
	if not icon.is_empty(): button.icon = load("res://assets/ui/%s.svg" % icon)
	for state in ["normal", "hover", "pressed", "disabled", "focus"]:
		var box := StyleBoxFlat.new()
		box.bg_color = Color(0, 0, 0, 0)
		box.set_corner_radius_all(16)
		box.content_margin_top = 6
		box.content_margin_bottom = 4
		button.add_theme_stylebox_override(state, box)
	_paint_nav_button(button, false)
	button.pressed.connect(action)
	parent.add_child(button)
	return button

func _paint_nav_button(button: Button, active: bool) -> void:
	var tint := Color(NAV_ACCENT) if active else Color(NAV_ICON_IDLE)
	for state in ["icon_normal_color", "icon_hover_color", "icon_pressed_color", "icon_focus_color"]:
		button.add_theme_color_override(state, tint)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		button.add_theme_color_override(state, tint)
	var normal: StyleBoxFlat = button.get_theme_stylebox("normal")
	normal.bg_color = Color(NAV_ACCENT + "17") if active else Color(0, 0, 0, 0)

## Highlights the nav item for the currently open management panel (or none
## while driving the store floor), called from game_shell.gd's
## open_panel/close_panel so the bar always reflects where the player is.
func set_active_panel(id: String) -> void:
	if active_panel_id == id: return
	active_panel_id = id
	for panel_id in nav_buttons: _paint_nav_button(nav_buttons[panel_id], panel_id == id)

func _layout() -> void:
	if top == null: return
	var safe := MarketSafeArea.insets(get_viewport())
	var compact := size.x <= 580
	brand.visible = not compact
	level.visible = size.x > 480
	money.custom_minimum_size.x = 0 if compact else 124
	clock_label.custom_minimum_size.x = 0 if compact else 72
	money.add_theme_font_size_override("font_size", 14 if compact else 18)
	top.size = Vector2(maxf(top.get_combined_minimum_size().x, minf(790, size.x - 24)), 58)
	top.position = Vector2((size.x - top.size.x) / 2, maxf(10, safe.y))
	# Flush against the footer: the bar's own background reaches the screen's
	# bottom edge (covering the home-indicator strip like a native tab bar),
	# with the safe-area inset added as inner bottom padding instead of a gap
	# above it, so the tappable icons stay clear of that strip.
	var menu_style: StyleBoxFlat = menu.get_theme_stylebox("panel")
	menu_style.content_margin_bottom = maxf(8, safe.w)
	# Seven labeled buttons need ~402px minimum; below that (an iPhone SE or
	# narrower) drop to icon-only so the bar still actually fits its own
	# footer instead of overflowing it.
	var nav_compact := size.x < 420
	for panel_id in nav_buttons:
		var button: Button = nav_buttons[panel_id]
		button.text = "" if nav_compact else NAV_LABEL_ES[panel_id]
	# Full width on a phone; capped so seven icons do not end up paper-thin
	# and far apart on a tablet/desktop viewport, while the bar's own
	# background still reaches edge to edge like a real footer. -12 accounts
	# for the panel's own fixed 6+6 left/right content margins, or this
	# request for the bar's own minimum size overshoots size.x by exactly
	# that much and the "flush footer" contract breaks on a narrow phone.
	nav_row.custom_minimum_size.x = minf(620, size.x) - 12
	menu.size = Vector2(size.x, menu.get_combined_minimum_size().y)
	menu.position = Vector2(0, size.y - menu.size.y)
	# The nav bar is now flush with the footer and spans the full width, so
	# anything that used to float above the bottom edge/safe-area independently
	# must instead clear the bar's own top edge (menu.position.y) or it now
	# sits underneath the bar.
	player_card.visible = size.x > 820
	player_card.size = player_card.get_combined_minimum_size()
	player_card.position = Vector2(size.x - player_card.size.x - maxf(14, safe.z), menu.position.y - player_card.size.y - 14)
	carry_card.size = carry_card.get_combined_minimum_size()
	carry_card.position = Vector2(maxf(14, safe.x), menu.position.y - carry_card.size.y - 14) if size.x > 820 else Vector2(size.x - carry_card.size.x - maxf(8, safe.z), menu.position.y - carry_card.size.y - 10)
	guide.size.x = 256
	guide.position = Vector2(size.x - 256 - maxf(12, safe.z), maxf(80, safe.y + 70))
	toast.position = Vector2((size.x - toast.size.x) / 2, menu.position.y - toast.size.y - 12)

func update(game: Dictionary, franchise: Dictionary, store: MarketStore, player_name: String) -> void:
	guide.visible = game.level == 1 and game.tutorialStep > 0
	if guide.visible:
		var instruction := LevelOneGuide.presentation(game, franchise)
		guide_button.text = "%d · %s\n%s" % [instruction.activeStep, instruction.eyebrow, instruction.title]
		guide_detail.text = instruction.description
		guide_progress.value = minf(100, instruction.progress)
	name_label.text = franchise.name
	city.text = franchise.city
	money.text = MarketEngine.format_money(game.balanceMinor, game)
	var minute := int(floor(game.minuteOfDay))
	clock_label.text = "%02d:%02d" % [int(minute / 60) % 24, minute % 60]
	level.text = "Nivel %d" % (CampaignLevels.campaign_level(franchise) if franchise.get("purchases") != null else game.level)
	toggle.disabled = BusinessDay.business_day_is_closing(game.minuteOfDay)
	toggle.text = "CERRANDO" if toggle.disabled else ("ABIERTO" if franchise.open else "CERRADO")
	var badge := SaveBadgePolicy.save_badge_presentation(store.save_status, store.last_save_confirmed_at, Time.get_unix_time_from_system() * 1000)
	save.tooltip_text = badge.label
	save.text = badge.label + "\n" + str(game.lastSavedAt).substr(11, 8)
	player_label.text = player_name
	reputation.text = "Reputación %d" % game.reputation
	var quantity := CarrySystem.carry_total(franchise.carry)
	carry_card.visible = quantity > 0
	var products := CarrySystem.carried_product_ids(franchise.carry)
	carry_title.text = "Cesta · %d %s" % [products.size(), "producto" if products.size() == 1 else "productos"]
	carry_label.text = "%d/%d" % [quantity, franchise.carry.capacity]
	_layout.call_deferred()

func _audio_settings_changed(settings: Dictionary) -> void:
	sound.icon = load("res://assets/ui/%s.svg" % ("muted" if settings.music <= 0 and settings.effects <= 0 else "sound"))
