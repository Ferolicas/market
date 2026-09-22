class_name MarketWidgets
extends RefCounted

static func theme() -> Theme:
	var result := Theme.new()
	result.default_font = load("res://assets/fonts/OpenSans-SemiBold.ttf")
	result.default_font_size = 16
	result.set_color("font_color", "Label", Color("24453d"))
	result.set_color("font_color", "Button", Color("24453d"))
	result.set_color("font_hover_color", "Button", Color("173f35"))
	result.set_color("font_disabled_color", "Button", Color("70766b"))
	for state in ["normal", "hover", "pressed", "focus", "disabled"]:
		var style := StyleBoxFlat.new()
		style.bg_color = Color("f7f2e8") if state == "normal" else Color("dce8dd")
		if state == "disabled": style.bg_color = Color("d8d9d4")
		style.set_corner_radius_all(10)
		style.content_margin_left = 16
		style.content_margin_right = 16
		style.content_margin_top = 12
		style.content_margin_bottom = 12
		if state == "focus":
			style.set_border_width_all(2)
			style.border_color = Color("2f6958")
		result.set_stylebox(state, "Button", style)
	var panel := StyleBoxFlat.new()
	panel.bg_color = Color("fffaf0")
	panel.set_corner_radius_all(18)
	panel.content_margin_left = 24
	panel.content_margin_right = 24
	panel.content_margin_top = 24
	panel.content_margin_bottom = 24
	result.set_stylebox("panel", "PanelContainer", panel)
	return result

static func label(parent: Node, text: String, size: int = 16) -> Label:
	var item := Label.new()
	item.text = text
	item.add_theme_font_size_override("font_size", size)
	parent.add_child(item)
	return item

static func button(parent: Node, text: String, action: Callable, disabled: bool = false) -> Button:
	var item := Button.new()
	item.text = text
	# ScrollContainer implements touch panning through emulated mouse input.
	# A child button must let that input reach it; SCROLL_BEGIN cancels the click.
	var ancestor: Node = parent
	while ancestor != null:
		if ancestor is ScrollContainer:
			item.mouse_filter = Control.MOUSE_FILTER_PASS
			break
		ancestor = ancestor.get_parent()
	item.custom_minimum_size.y = 48
	item.disabled = disabled
	item.pressed.connect(action)
	parent.add_child(item)
	return item

static func field(parent: Node, title: String, secret: bool = false) -> LineEdit:
	label(parent, title)
	var item := LineEdit.new()
	item.secret = secret
	item.custom_minimum_size = Vector2(320, 44)
	parent.add_child(item)
	return item

static func clear(parent: Node) -> void:
	for child in parent.get_children():
		parent.remove_child(child)
		child.queue_free()

static func grid(parent: Control, desktop: int, tablet: int, phone: int) -> GridContainer:
	var item := GridContainer.new()
	item.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	item.add_theme_constant_override("h_separation", 12)
	item.add_theme_constant_override("v_separation", 12)
	parent.add_child(item)
	var viewport := parent.get_viewport()
	var reflow := func():
		var width := viewport.get_visible_rect().size.x
		item.columns = phone if width <= 520 else (tablet if width <= 820 else desktop)
	reflow.call()
	viewport.size_changed.connect(reflow)
	item.tree_exiting.connect(func():
		if viewport.size_changed.is_connected(reflow): viewport.size_changed.disconnect(reflow))
	return item

static func card(parent: Control) -> VBoxContainer:
	var panel := PanelContainer.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	# Same fix as button() above: PanelContainer defaults to MOUSE_FILTER_STOP,
	# so a touch-drag or wheel scroll starting anywhere on a card's own
	# background (not precisely on a Label, which already passes it through)
	# never reached the panel's ScrollContainer ancestor — scrolling looked
	# "locked" on every card-heavy panel (stock/team/map/finance).
	var ancestor: Node = parent
	while ancestor != null:
		if ancestor is ScrollContainer:
			panel.mouse_filter = Control.MOUSE_FILTER_PASS
			break
		ancestor = ancestor.get_parent()
	var style := StyleBoxFlat.new()
	style.bg_color = Color("fffdf8")
	style.border_color = Color("ded8ca")
	style.set_border_width_all(1)
	style.set_corner_radius_all(18)
	style.content_margin_left = 12
	style.content_margin_right = 12
	style.content_margin_top = 15
	style.content_margin_bottom = 13
	panel.add_theme_stylebox_override("panel", style)
	parent.add_child(panel)
	var content := VBoxContainer.new()
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_theme_constant_override("separation", 6)
	panel.add_child(content)
	return content

static func copy(parent: Control, text: String, font_size: int = 14, centered: bool = false) -> Label:
	var item := label(parent, text, font_size)
	item.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	item.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if centered: item.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return item

static func emoji(parent: Control, text: String, extent: int = 64) -> TextureRect:
	var item := TextureRect.new()
	item.texture = emoji_texture(text)
	item.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	item.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	item.custom_minimum_size = Vector2(extent, extent)
	item.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(item)
	return item

static func emoji_texture(text: String) -> Texture2D:
	var parts: Array[String] = []
	for index in text.length(): parts.append("%x" % text.unicode_at(index))
	return load("res://assets/ui/emoji/" + "-".join(parts) + ".png")

static func country_flag(code: String) -> String:
	return String.chr(code.unicode_at(0) + 127397) + String.chr(code.unicode_at(1) + 127397)
