class_name MarketAvatarPreview
extends TextureRect
## AvatarCustomizer.tsx camera framing and drag orbit, rendered with the delivered rig.
var viewport: SubViewport
var actor: MarketActor
var camera: Camera3D
var azimuth := 0.0
var polar := PI / 2.0
var dragging := false
var config: Dictionary = {}
var lighting := SourcePbr.new()

func _ready() -> void:
	custom_minimum_size = Vector2(0, 260)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	stretch_mode = TextureRect.STRETCH_SCALE
	mouse_filter = Control.MOUSE_FILTER_STOP
	# The transparent 3D target already contains premultiplied colour, as does
	# the original WebGL canvas. Do not multiply translucent shadows twice.
	material = MarketViewportComposite.create()
	viewport = SubViewport.new()
	# Forward Mobile's default RGB10A2 buffer rounds opacity 0.2 to 1/3.
	viewport.use_hdr_2d = RenderingServer.get_current_rendering_method() != "gl_compatibility"
	viewport.own_world_3d = true
	viewport.msaa_3d = Viewport.MSAA_4X
	viewport.transparent_bg = true
	viewport.handle_input_locally = false
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(viewport)
	texture = viewport.get_texture()
	var environment := WorldEnvironment.new()
	environment.environment = Environment.new()
	environment.environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	environment.environment.background_mode = Environment.BG_COLOR
	environment.environment.background_color = Color(0, 0, 0, 0)
	environment.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.environment.ambient_light_color = Color.WHITE
	environment.environment.ambient_light_energy = 0
	viewport.add_child(environment)
	var light := DirectionalLight3D.new()
	light.light_energy = 2.2 / PI
	light.shadow_enabled = true
	viewport.add_child(light)
	light.position = Vector3(3, 5, 4)
	light.look_at(Vector3.ZERO)
	actor = MarketActor.new()
	viewport.add_child(actor)
	camera = Camera3D.new()
	camera.fov = 34
	viewport.add_child(camera)
	resized.connect(_frame_camera)
	if not config.is_empty(): update_avatar(config)
	_frame_camera()
	lighting.studio = true
	lighting.scope = viewport
	viewport.add_child(lighting)

func update_avatar(value: Dictionary) -> void:
	config = value.duplicate(true)
	if actor != null:
		actor.configure_avatar(config, 1.0 / CharacterScale.character_scene_scale(config.body))

func _frame_camera() -> void:
	if camera == null: return
	var density := clampf(float(AdaptiveQuality.current_render_capabilities().devicePixelRatio), 1.0, 1.5)
	viewport.size = Vector2i(maxi(2, roundi(size.x * density)), maxi(2, roundi(size.y * density)))
	var span := maxf(1.9, 0.85 / maxf(0.2, size.x / maxf(1, size.y)))
	var distance := span / (2 * tan(deg_to_rad(34) / 2))
	var radius := Vector2(distance, 0.1).length()
	var orbit_polar := polar - atan2(0.1, distance)
	camera.position = Vector3(sin(azimuth) * sin(orbit_polar), cos(orbit_polar), cos(azimuth) * sin(orbit_polar)) * radius + Vector3(0, 0.55, 0)
	camera.look_at(Vector3(0, 0.55, 0))

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		dragging = event.pressed
		accept_event()
	elif event is InputEventMouseMotion and dragging:
		_orbit(event.relative)
	elif event is InputEventScreenTouch:
		dragging = event.pressed
		accept_event()
	elif event is InputEventScreenDrag:
		_orbit(event.relative)

func _orbit(relative: Vector2) -> void:
	azimuth -= TAU * relative.x / maxf(1, size.y)
	polar = clampf(polar - TAU * relative.y / maxf(1, size.y), PI / 2.5, PI / 1.85)
	_frame_camera()
	accept_event()
