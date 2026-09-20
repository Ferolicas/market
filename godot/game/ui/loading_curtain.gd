class_name MarketLoadingCurtain
extends Control
## LoadingCurtain.tsx: native opening card, indeterminate until actual readiness.
var card: PanelContainer
var art: TextureRect
var art_holder: Control
var rail: Control
var bar: ColorRect
var elapsed := 0.0
func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	z_index = 120
	var background := TextureRect.new()
	var texture := GradientTexture2D.new()
	texture.gradient = Gradient.new()
	texture.gradient.colors = PackedColorArray([Color("244e40"), Color("0d241d")])
	texture.fill = GradientTexture2D.FILL_RADIAL
	texture.fill_from = Vector2(0.5, 0.3)
	texture.fill_to = Vector2(0.5, 1.05)
	background.texture = texture
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	background.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(background)
	card = PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color("19382eee")
	style.border_color = Color("dab77944")
	style.set_border_width_all(1)
	style.set_corner_radius_all(32)
	style.content_margin_left = 30
	style.content_margin_right = 30
	style.content_margin_top = 30
	style.content_margin_bottom = 30
	card.add_theme_stylebox_override("panel", style)
	add_child(card)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 14)
	card.add_child(column)
	label(column, "MINI MARKET · TU HISTORIA EMPIEZA AQUÍ", 9, "d7bd86")
	art_holder = Control.new()
	art_holder.custom_minimum_size.y = 190
	column.add_child(art_holder)
	art = TextureRect.new()
	art.texture = preload("res://assets/ui/loading-store.svg")
	art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	art_holder.add_child(art)
	var brand := label(column, "Pequeña tienda.", 36, "faf3df")
	brand.add_theme_font_override("font", preload("res://assets/fonts/NotoSerif-Regular.ttf"))
	var dreams := label(column, "Grandes sueños.", 36, "e8ce96")
	dreams.add_theme_font_override("font", preload("res://assets/fonts/NotoSerif-Italic.ttf"))
	label(column, "Preparando la tienda…", 13, "f9f2df")
	label(column, "Cargando personajes y maquinaria sin interrupciones", 11, "bdcfc4")
	rail = ColorRect.new()
	rail.color = Color("ffffff16")
	rail.custom_minimum_size.y = 3
	rail.clip_contents = true
	column.add_child(rail)
	bar = ColorRect.new()
	bar.color = Color("f5d59b")
	rail.add_child(bar)
	label(column, "DE LA GRANJA A TU BARRIO · PREPARANDO", 9, "a5bbad")
	resized.connect(layout)
	column.minimum_size_changed.connect(func(): layout.call_deferred())
	layout.call_deferred()

func label(parent: Node, text: String, font_size: int, color: String) -> Label:
	var node := MarketWidgets.label(parent, text, font_size)
	node.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	node.add_theme_color_override("font_color", Color(color))
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return node

func layout() -> void:
	if card == null: return
	card.size = Vector2(minf(460, size.x * 0.92), 0)
	card.position = (size - card.size) / 2
	art_holder.custom_minimum_size.y = 130 if size.y < 650 else 190

func _process(delta: float) -> void:
	elapsed += delta
	bar.size = Vector2(rail.size.x * 0.42, 3)
	bar.position.x = lerpf(-bar.size.x, rail.size.x, (1 - cos(fmod(elapsed, 1.25) / 1.25 * PI)) / 2)
	var width := 130.0 if size.y < 650 else 180.0
	art.size = Vector2(width, width * 120 / 140)
	art.position = (art_holder.size - art.size) / 2 - Vector2(0, 7 * (1 - cos(elapsed * PI / 1.6)) / 2)
