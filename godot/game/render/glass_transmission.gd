class_name MarketGlassTransmission
extends Node
## Original Three opaque linear-HDR transmission pass and its first mip levels.
## Thin source glass has thickness=0, IOR=1.5 and roughness <= 0.13, so three
## levels cover its bicubic LOD even at 8K. No GPU readback occurs per frame.
var world: MarketWorld
var levels: Array[SubViewport] = []
var camera := Camera3D.new()
var enabled := false

func _ready() -> void:
	process_priority = 100
	# Children render before parents: level 0 -> level 1 -> level 2 -> main.
	var parent: Node = self
	for index in range(2, -1, -1):
		var viewport := SubViewport.new()
		viewport.name = "TransmissionMip%d" % index
		viewport.use_hdr_2d = true
		viewport.size = Vector2i(4, 4)
		viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
		viewport.disable_3d = index > 0
		parent.add_child(viewport)
		levels.push_front(viewport)
		parent = viewport
	levels[0].world_3d = world.get_world_3d()
	levels[0].msaa_3d = Viewport.MSAA_4X
	levels[0].add_child(camera)
	camera.cull_mask = 2
	camera.current = true
	world.camera.cull_mask = 1
	world.sun.layers = 3
	for index in range(1, 3):
		var image := TextureRect.new()
		image.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		image.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
		image.texture = levels[index - 1].get_texture()
		levels[index].add_child(image)
	for index in 3:
		RenderingServer.global_shader_parameter_set("market_transmission_%d" % index, levels[index].get_texture())
	_process(0)

func _process(_delta: float) -> void:
	if levels.is_empty(): return
	var active: bool = world.rendering.profile.get("glassTransmission", false)
	if active != enabled:
		enabled = active
		for viewport in levels: viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS if enabled else SubViewport.UPDATE_DISABLED
	if not enabled: return
	var main := world.get_viewport()
	var dimensions := Vector2i(Vector2(world.get_window().size) * main.scaling_3d_scale)
	for index in levels.size():
		levels[index].size = Vector2i(maxi(1, dimensions.x >> index), maxi(1, dimensions.y >> index))
	camera.global_transform = world.camera.global_transform
	camera.projection = world.camera.projection
	camera.keep_aspect = world.camera.keep_aspect
	camera.size = world.camera.size
	camera.fov = world.camera.fov
	camera.near = world.camera.near
	camera.far = world.camera.far
	camera.h_offset = world.camera.h_offset
	camera.v_offset = world.camera.v_offset

func _exit_tree() -> void:
	for index in 3: RenderingServer.global_shader_parameter_set("market_transmission_%d" % index, null)
