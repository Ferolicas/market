class_name MarketAuthScreen
extends Control
## src/components/auth/AuthScreen.tsx, using the same Better Auth endpoints.
signal authenticated(user: Dictionary)
signal returned_home
const Widgets = preload("res://game/ui/widgets.gd")
var api: MarketApi
var mode := "login"
var form: VBoxContainer
var fields: Dictionary = {}
var status: Label
var submit_button: Button
var busy := false
var reset_token := ""
var scroll: ScrollContainer
var card: PanelContainer
var hero: PanelContainer

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	theme = Widgets.theme()
	for state in ["normal", "focus", "read_only"]:
		var input_style := StyleBoxFlat.new()
		input_style.bg_color = Color("fbfdfb")
		input_style.border_color = Color("56b997") if state == "focus" else Color("dce8e2")
		input_style.set_border_width_all(1)
		input_style.set_corner_radius_all(12)
		input_style.content_margin_left = 14
		input_style.content_margin_right = 14
		theme.set_stylebox(state, "LineEdit", input_style)
	theme.set_color("font_color", "LineEdit", Color("193d34"))
	theme.set_color("font_placeholder_color", "LineEdit", Color("758a84"))
	theme.set_color("caret_color", "LineEdit", Color("193d34"))
	var background := ColorRect.new()
	background.color = Color("fff9e9")
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(background)
	hero = PanelContainer.new()
	add_child(hero)
	var gradient := Gradient.new()
	gradient.colors = PackedColorArray([Color("194d40"), Color("236758"), Color("4b9f80")])
	gradient.offsets = PackedFloat32Array([0, 0.5, 1])
	var texture := GradientTexture2D.new()
	texture.gradient = gradient
	texture.fill_to = Vector2(1, 1)
	var hero_style := StyleBoxTexture.new()
	hero_style.texture = texture
	for side in [SIDE_LEFT, SIDE_RIGHT, SIDE_TOP, SIDE_BOTTOM]: hero_style.set_content_margin(side, 40)
	hero.add_theme_stylebox_override("panel", hero_style)
	var copy := VBoxContainer.new()
	copy.add_theme_constant_override("separation", 14)
	hero.add_child(copy)
	for entry in [["● OLCAS GAMES", 14], ["DE EMPLEADO A MAGNATE", 12], ["Tu pequeño mercado.", 36], ["Tu gran imperio.", 36], ["Trabaja, produce, contrata y abre franquicias en un mundo low-poly creado para jugar en cualquier dispositivo.", 18], ["Producción real · Empleados autónomos · Franquicias globales", 14]]:
		var label := Widgets.copy(copy, entry[0], entry[1])
		label.add_theme_color_override("font_color", Color("ffda7b") if entry[0] == "Tu gran imperio." else Color.WHITE)
	var illustration := TextureRect.new()
	illustration.texture = preload("res://assets/ui/auth-market.png")
	illustration.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	illustration.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	illustration.size_flags_vertical = Control.SIZE_EXPAND_FILL
	copy.add_child(illustration)
	scroll = ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(scroll)
	var center := CenterContainer.new()
	center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.add_child(center)
	card = PanelContainer.new()
	center.add_child(card)
	form = VBoxContainer.new()
	form.add_theme_constant_override("separation", 10)
	card.add_child(form)
	resized.connect(_settle_layout)
	_show_mode()
	_reflow()

func _reflow() -> void:
	if scroll == null: return
	var desktop: bool = size.x > 820 and mode != "reset" and not AdaptiveQuality.current_render_capabilities().coarsePointer
	hero.visible = desktop
	var left := size.x * 0.55 if desktop else 0.0
	hero.position = Vector2.ZERO
	hero.size = Vector2(left, size.y)
	var safe := MarketSafeArea.insets(get_viewport())
	var margins := Vector4(maxf(20, safe.x), maxf(20, safe.y), maxf(20, safe.z), maxf(20, safe.w))
	scroll.position = Vector2(left + margins.x, margins.y)
	var available := maxf(size.x - left - margins.x - margins.z, 0)
	card.custom_minimum_size.x = minf(440, maxf(available - 12, 0))
	scroll.size = Vector2(available, maxf(size.y - margins.y - margins.w, 0))

func _show_mode() -> void:
	Widgets.clear(form)
	fields.clear()
	Widgets.label(form, "Mini Market", 28)
	Widgets.label(form, "Simulador empresarial 3D")
	Widgets.label(form, {"login": "Bienvenido de vuelta", "register": "Crea tu empresa", "forgot": "Recupera tu acceso", "reset": "Nueva contraseña"}[mode], 22)
	var intro := Widgets.label(form, {"login": "Tu tienda y tus empleados te esperan.", "register": "Tu progreso quedará protegido en la nube.", "forgot": "Te enviaremos un enlace seguro de un solo uso.", "reset": ""}[mode])
	intro.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	if mode == "register":
		fields["name"] = Widgets.field(form, "Tu nombre")
		fields["username"] = Widgets.field(form, "Nombre de usuario")
		fields.username.max_length = 24
	if mode != "reset": fields["identity"] = Widgets.field(form, "Correo o usuario" if mode == "login" else "Correo electrónico")
	if mode != "forgot": fields["password"] = Widgets.field(form, "Contraseña", true)
	if mode == "reset": fields["confirm"] = Widgets.field(form, "Repetir contraseña", true)
	for key in fields:
		var field: LineEdit = fields[key]
		field.custom_minimum_size.x = 0
		field.text_submitted.connect(func(_value: String): _submit())
		field.placeholder_text = {"name": "Ferney", "username": "ferney_market", "identity": "tu@correo.com", "password": "Mínimo 10 caracteres"}.get(key, "")
		if key == "identity" and mode != "login": field.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_EMAIL_ADDRESS
	status = Widgets.label(form, "")
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	submit_button = Widgets.button(form, {"login": "Entrar al mercado", "register": "Crear perfil y jugar", "forgot": "Enviar enlace", "reset": "Guardar contraseña"}[mode], _submit)
	for state in ["normal", "hover", "pressed", "disabled"]:
		var primary: StyleBoxFlat = theme.get_stylebox(state, "Button").duplicate()
		primary.bg_color = Color("ee7455") if state != "pressed" else Color("e85d44")
		submit_button.add_theme_stylebox_override(state, primary)
	submit_button.add_theme_color_override("font_color", Color.WHITE)
	submit_button.add_theme_color_override("font_hover_color", Color.WHITE)
	submit_button.add_theme_color_override("font_pressed_color", Color.WHITE)
	if mode == "login": Widgets.button(form, "Olvidé mi contraseña", func(): _change_mode("forgot"))
	Widgets.button(form, {"login": "Crear perfil nuevo", "register": "Ya tengo cuenta", "forgot": "Volver al acceso", "reset": "Volver al inicio"}[mode], func(): _change_mode("register" if mode == "login" else "login"))
	Widgets.label(form, "Partida privada · Autosave cifrado en tránsito", 12)
	for child in form.get_children():
		if child is Label: child.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		if child is Button: child.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	fields["password" if mode == "reset" else "identity"].grab_focus()
	_reflow()
	_settle_layout.call_deferred()

func _settle_layout() -> void:
	card.reset_size()
	scroll.get_child(0).reset_size()
	_reflow()

func _change_mode(value: String) -> void:
	if busy: return
	if mode == "reset" and OS.has_feature("web"):
		JavaScriptBridge.eval("(() => { const u = new URL(location.href); for (const k of ['auth','token','error']) u.searchParams.delete(k); history.replaceState(null,'',u); })()", true)
	var was_reset := mode == "reset"
	mode = value
	_show_mode()
	if was_reset: returned_home.emit()

func _submit() -> void:
	if busy: return
	var identity: String = fields.identity.text.strip_edges().to_lower() if "identity" in fields else ""
	var password: String = fields.password.text if "password" in fields else ""
	if (mode != "reset" and identity.is_empty()) or (mode != "forgot" and password.length() < 10):
		status.text = "Completa los campos. La contraseña requiere al menos 10 caracteres."
		return
	if mode in ["register", "forgot"] and RegEx.create_from_string("^[^@\\s]+@[^@\\s]+$").search(identity) == null:
		status.text = "Introduce un correo electrónico válido."
		return
	if mode == "reset" and password != fields.confirm.text:
		status.text = "Las contraseñas no coinciden."
		return
	if mode == "register":
		var valid_username := RegEx.create_from_string("^[a-zA-Z0-9_.]{3,24}$")
		if fields.name.text.strip_edges().length() < 2 or valid_username.search(fields.username.text.strip_edges()) == null:
			status.text = "Introduce tu nombre y un usuario de 3 a 24 letras, números, puntos o guiones bajos."
			return
	busy = true
	submit_button.disabled = true
	status.text = "Un momento…"
	var response: Dictionary
	if mode == "register":
		response = await api.request_json("/api/auth/sign-up/email", "POST", {"email": identity, "password": password, "name": fields.name.text.strip_edges(), "username": fields.username.text.strip_edges().to_lower()})
	elif mode == "forgot":
		response = await api.request_json("/api/auth/request-password-reset", "POST", {"email": identity, "redirectTo": _reset_redirect()})
	elif mode == "reset":
		response = await api.request_json("/api/auth/reset-password", "POST", {"newPassword": password, "token": reset_token})
	else:
		response = await api.sign_in(identity, password)
	busy = false
	submit_button.disabled = false
	if not response.ok:
		status.text = response.data.get("message", "No se pudo completar la operación.")
	elif mode == "forgot": status.text = "Si el correo existe, recibirás un enlace de restablecimiento desde olcas.app."
	elif mode == "reset": status.text = "Contraseña actualizada. Ya puedes volver a entrar."
	else: authenticated.emit(response.data.get("user", {}))

func _reset_redirect() -> String:
	if OS.has_feature("web"):
		return str(JavaScriptBridge.eval("location.origin + location.pathname + '?auth=reset'", true))
	return api.base_url.trim_suffix("/") + "/reset-password"
