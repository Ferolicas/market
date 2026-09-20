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
	menu = _card(5, 19)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 3)
	menu.add_child(buttons)
	for entry in [["stock", "inventory", "Inventario"], ["orders", "suppliers", "Pedidos"], ["team", "team", "Equipo"], ["map", "map", "Franquicias"], ["finance", "finance", "Finanzas"], ["avatar", "avatar", "Avatar"], ["help", "help", "Cómo jugar"]]:
		var button := _button(buttons, entry[1], entry[2], func(): panel_requested.emit(entry[0]))
		button.custom_minimum_size = Vector2(46, 46)
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
	menu.size = menu.get_combined_minimum_size()
	menu.position = Vector2((size.x - menu.size.x) / 2, size.y - menu.size.y - maxf(10, safe.w))
	player_card.visible = size.x > 820
	player_card.size = player_card.get_combined_minimum_size()
	player_card.position = Vector2(size.x - player_card.size.x - maxf(14, safe.z), size.y - player_card.size.y - maxf(14, safe.w))
	carry_card.size = carry_card.get_combined_minimum_size()
	carry_card.position = Vector2(maxf(14, safe.x), size.y - carry_card.size.y - maxf(14, safe.w)) if size.x > 820 else Vector2(size.x - carry_card.size.x - maxf(8, safe.z), size.y - carry_card.size.y - maxf(64, safe.w + 54))
	guide.size.x = 256
	guide.position = Vector2(size.x - 256 - maxf(12, safe.z), maxf(80, safe.y + 70))
	toast.position = Vector2((size.x - toast.size.x) / 2, size.y - maxf(112, safe.w + 102))

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
