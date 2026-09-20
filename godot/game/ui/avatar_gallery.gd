class_name MarketAvatarGallery
extends Node
## AvatarThumbnails.tsx: one real 192px rig at a time, cached after four draws.
var viewport: SubViewport
var actor: MarketActor
var camera: Camera3D
var lighting: SourcePbr
var requests := []
var known := {}
var images := {}
var callbacks := {}
var current := {}
var frames := 0

func _ready() -> void:
	viewport = SubViewport.new()
	viewport.use_hdr_2d = RenderingServer.get_current_rendering_method() != "gl_compatibility"
	viewport.size = Vector2i(192, 192)
	viewport.own_world_3d = true
	viewport.transparent_bg = true
	viewport.msaa_3d = Viewport.MSAA_4X
	viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(viewport)
	var environment := WorldEnvironment.new()
	environment.environment = Environment.new()
	environment.environment.background_mode = Environment.BG_COLOR
	environment.environment.background_color = Color(0, 0, 0, 0)
	environment.environment.ambient_light_source = Environment.AMBIENT_SOURCE_DISABLED
	viewport.add_child(environment)
	var light := DirectionalLight3D.new()
	light.light_energy = 2.1 / PI
	viewport.add_child(light)
	light.position = Vector3(2.4, 4, 3)
	light.look_at(Vector3.ZERO)
	actor = MarketActor.new()
	viewport.add_child(actor)
	camera = Camera3D.new()
	camera.fov = 32
	viewport.add_child(camera)
	lighting = SourcePbr.new()
	lighting.studio = true
	lighting.thumbnail = true
	lighting.scope = viewport
	viewport.add_child(lighting)

func request(id: String, config: Dictionary, framing: String, complete: Callable) -> void:
	if images.has(id):
		if complete.is_valid(): complete.call(images[id])
		return
	if not callbacks.has(id): callbacks[id] = []
	callbacks[id].append(complete)
	if known.has(id): return
	known[id] = true
	requests.append({"id": id, "avatar": config.duplicate(true), "framing": framing})

func _process(_delta: float) -> void:
	# The headless renderer cannot produce portraits; CPU scene tests still
	# exercise the request queue, while GPU/browser QA checks the actual image.
	if DisplayServer.get_name() == "headless": return
	if current.is_empty():
		if requests.is_empty(): return
		current = requests.pop_front()
		frames = 0
		actor.configure_avatar(current.avatar, 1.0 / CharacterScale.character_scene_scale(current.avatar.body))
		viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	frames += 1
	if frames == 1:
		var index := actor.skeleton.find_bone("Head")
		var head := actor.skeleton.global_transform * actor.skeleton.get_bone_global_pose(index).origin if index >= 0 else Vector3(0, 1, 0)
		if current.framing == "head":
			camera.position = Vector3(0, head.y, head.z + 0.72)
			camera.look_at(Vector3(0, head.y, head.z))
		else:
			camera.position = Vector3(0, head.y * 0.56, head.y * 2.6)
			camera.look_at(Vector3(0, head.y * 0.56, 0))
		return
	if frames < 5: return # Four completed native draw passes.
	var image := viewport.get_texture().get_image()
	if image.is_empty(): return
	var texture := ImageTexture.create_from_image(image)
	images[current.id] = texture
	for callback in callbacks[current.id]:
		if callback.is_valid(): callback.call(texture)
	callbacks.erase(current.id)
	current = {}
	viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
