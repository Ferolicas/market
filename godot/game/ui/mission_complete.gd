class_name MarketMissionComplete
extends Control
## Original MissionComplete.tsx: passive three-second purchase celebration.
const VISIBLE_SECONDS := 3.0
var elapsed := 0.0
var purchase_label := ""
var card: PanelContainer
var medal: TextureRect
var timer: ColorRect
var description: Label
var sparks: Array[Panel] = []
var background: TextureRect
var burst: Control

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	z_index = 140
	var backdrop := ColorRect.new()
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	backdrop.color = Color.WHITE
	var blur := ShaderMaterial.new()
	blur.shader = preload("res://game/ui/mission_backdrop.gdshader")
	backdrop.material = blur
	backdrop.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(backdrop)
	card = PanelContainer.new()
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var style := StyleBoxFlat.new()
	style.bg_color = Color.TRANSPARENT
	style.border_color = Color("e6c68788")
	style.set_border_width_all(1)
	style.set_corner_radius_all(30)
	style.content_margin_left = 24
	style.content_margin_right = 24
	style.content_margin_top = 34
	style.content_margin_bottom = 30
	card.add_theme_stylebox_override("panel", style)
	add_child(card)
	var decoration := Node2D.new()
	card.add_child(decoration)
	background = TextureRect.new()
	background.texture = preload("res://assets/ui/mission-background.svg")
	background.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	background.mouse_filter = Control.MOUSE_FILTER_IGNORE
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	decoration.add_child(background)
	burst = Control.new()
	burst.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	burst.clip_contents = true
	burst.mouse_filter = Control.MOUSE_FILTER_IGNORE
	decoration.add_child(burst)
	for index in 12:
		var spark := Panel.new()
		var spark_style := StyleBoxFlat.new()
		spark_style.bg_color = Color("f4c65c")
		spark_style.set_corner_radius_all(2)
		spark.add_theme_stylebox_override("panel", spark_style)
		spark.size = Vector2(9, 9)
		spark.pivot_offset = Vector2(4.5, 4.5)
		spark.mouse_filter = Control.MOUSE_FILTER_IGNORE
		burst.add_child(spark)
		sparks.append(spark)
	var column := VBoxContainer.new()
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_theme_constant_override("separation", 13)
	card.add_child(column)
	column.minimum_size_changed.connect(func(): _layout.call_deferred())
	_label(column, "UN PASO MÁS EN TU HISTORIA", 10, "e5c88a")
	medal = TextureRect.new()
	medal.texture = load("res://assets/ui/achievement-medal.svg")
	medal.custom_minimum_size = Vector2(140, 140)
	medal.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	medal.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	medal.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(medal)
	_label(column, "¡MISIÓN COMPLETADA!", 22, "fdf8e6")
	description = _label(column, purchase_label, 24, "f0dba9")
	description.add_theme_font_override("font", preload("res://assets/fonts/NotoSerif-Regular.ttf"))
	_label(column, "Tu esfuerzo hace crecer este lugar.", 11, "bbcfbf")
	timer = ColorRect.new()
	timer.color = Color("e5c88a")
	timer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.add_child(timer)
	resized.connect(_layout)
	_layout.call_deferred()
	visible = false

func _label(parent: Node, text: String, font_size: int, color: String) -> Label:
	var label := Label.new()
	label.text = text
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", Color(color))
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label

func show_purchase(value: String) -> void:
	purchase_label = value
	description.text = value
	elapsed = 0
	visible = true
	_layout.call_deferred()

func _layout() -> void:
	if card == null: return
	card.size = Vector2(minf(410, size.x * 0.9), 0)
	card.position = (size - card.size) / 2
	card.pivot_offset = card.size / 2

static func _css_ease(time: float, x1: float, y1: float, x2: float, y2: float) -> float:
	var low := 0.0
	var high := 1.0
	for iteration in 22:
		var t := (low + high) / 2
		var x := 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t
		if x < time: low = t
		else: high = t
	var t := (low + high) / 2
	return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t

func _process(delta: float) -> void:
	if not visible: return
	elapsed += delta
	if elapsed >= VISIBLE_SECONDS:
		visible = false
		return
	modulate.a = _css_ease(minf(1, elapsed / 0.26), 0.25, 0.1, 0.25, 1)
	var pop := _css_ease(minf(1, elapsed / 0.48), 0.18, 1.3, 0.38, 1)
	card.scale = Vector2.ONE * lerpf(0.82, 1, pop)
	card.position = (size - card.size) / 2 + Vector2(0, lerpf(18, 0, pop))
	card.modulate.a = clampf(pop, 0, 1)
	var arrival := _css_ease(minf(1, elapsed / 0.62), 0.2, 1.4, 0.4, 1)
	medal.pivot_offset = medal.size / 2
	medal.scale = Vector2.ONE * lerpf(0.6, 1, arrival)
	medal.rotation = deg_to_rad(lerpf(-8, 0, arrival))
	medal.modulate.a = clampf(arrival, 0, 1)
	background.position = Vector2.ZERO
	background.size = card.size
	burst.position = Vector2.ZERO
	burst.size = card.size
	for index in sparks.size():
		var spark := sparks[index]
		var time := elapsed - index * 0.09
		spark.visible = time >= 0
		if time < 0: continue
		var progress := fmod(time, 1.5) / 1.5
		var eased := _css_ease(progress, 0.2, 0.8, 0.3, 1)
		var angle := deg_to_rad(index * 30.0)
		spark.position = card.size / 2 + Vector2(0, -150 * eased).rotated(angle)
		spark.rotation = angle
		spark.scale = Vector2.ONE * lerpf(0.4, 1, eased)
		spark.modulate.a = _css_ease(progress / 0.3, 0.2, 0.8, 0.3, 1) if progress < 0.3 else 1 - _css_ease((progress - 0.3) / 0.7, 0.2, 0.8, 0.3, 1)
	timer.position = Vector2(0, card.size.y - 3)
	timer.size = Vector2(card.size.x * (1 - elapsed / VISIBLE_SECONDS), 3)
