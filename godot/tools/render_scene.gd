extends SceneTree
## Visual QA of the actual native scene; creates no account or persistent save.
const Store = preload("res://game/store.gd")
const World = preload("res://game/scene/market_world.gd")
const Shell = preload("res://game/ui/game_shell.gd")
var store: Store
var world: World
var frames := 0
func _init() -> void: _run.call_deferred()
func _run() -> void:
	# Offscreen portrait target avoids desktop window-manager height limits.
	var viewport: Viewport = root
	if not OS.get_environment("MARKET_QA_WIDTH").is_empty():
		var target := SubViewport.new()
		target.size = Vector2i(int(OS.get_environment("MARKET_QA_WIDTH")), int(OS.get_environment("MARKET_QA_HEIGHT")))
		target.own_world_3d = true
		target.render_target_update_mode = SubViewport.UPDATE_ALWAYS
		root.add_child(target)
		viewport = target
	if OS.get_environment("MARKET_QA_HDR") == "1": root.use_hdr_2d = true
	store = Store.new()
	store.recovery = RecoveryStorage.new()
	store.recovery.directory = "user://visual-qa-" + JS.uuid()
	store.add_child(store.recovery)
	viewport.add_child(store)
	var fixture := OS.get_environment("MARKET_QA_REFERENCE_STATE")
	store.game = JsonExact.parse(FileAccess.get_file_as_string(fixture)) if not fixture.is_empty() else MarketEngine.create_campaign_game()
	store.game.tutorialStep = 1
	world = World.new()
	world.store = store
	viewport.add_child(world)
	if OS.get_environment("MARKET_QA_HIDE_GLASS") == "1":
		for node in world.parts.building.nodes.values():
			if node is MeshInstance3D and node.get_active_material(0).transparency != BaseMaterial3D.TRANSPARENCY_DISABLED: node.visible = false
	if OS.get_environment("MARKET_QA_NO_SHADOWS") == "1": world.sun.shadow_enabled = false
	if OS.get_environment("MARKET_QA_UNCALIBRATED") == "1":
		world.environment.ambient_light_energy = 1.15 / PI
		world.sun.light_energy = 2.3 / PI
	var canvas := CanvasLayer.new()
	viewport.add_child(canvas)
	var shell := Shell.new()
	shell.store = store
	shell.world = world
	shell.player_name = "Prueba visual"
	canvas.add_child(shell)
	if OS.get_environment("MARKET_QA_NO_UI") == "1": canvas.hide()
	if OS.get_environment("MARKET_QA_AVATAR") == "1": shell.open_panel("avatar")
	if OS.get_environment("MARKET_QA_LOADING") == "1": canvas.add_child(MarketLoadingCurtain.new())
	if OS.get_environment("MARKET_QA_MISSION") == "1": shell.celebration.show_purchase("Granjero de tomates")
	for frame in (120 if OS.get_environment("MARKET_QA_AVATAR") == "1" else 45): await process_frame
	world.set_process(false)
	world.set_physics_process(false)
	if OS.get_environment("MARKET_QA_OVERVIEW") == "1":
		world.camera.position = Vector3(100,140,100)
		world.camera.look_at(Vector3.ZERO)
		world.camera.size = 120
	if OS.get_environment("MARKET_QA_UNCALIBRATED") == "1":
		world.environment.ambient_light_energy = 1.15 / PI
		world.sun.light_energy = 2.3 / PI
	if OS.get_environment("MARKET_QA_SINGLE_PASS") == "1": preload("res://tools/lighting/probe.gd").apply(world)
	await process_frame
	await RenderingServer.frame_post_draw
	var output := OS.get_cmdline_user_args()[0] if not OS.get_cmdline_user_args().is_empty() else "/tmp/market-godot-campaign.png"
	var image := viewport.get_texture().get_image()
	assert(not image.is_empty())
	assert(image.save_png(output) == OK)
	print("RENDERED ", output, " ", image.get_size())
	if OS.get_environment("MARKET_QA_TRANSMISSION_DUMP") == "1":
		print("CAPABILITIES ", world.rendering.capabilities, " PROFILE ", world.rendering.profile)
		for index in world.transmission.levels.size():
			var capture := world.transmission.levels[index].get_texture().get_image()
			if capture == null: continue
			var peak := 0.0
			for y in range(0, capture.get_height(), 8):
				for x in range(0, capture.get_width(), 8):
					var color := capture.get_pixel(x, y)
					peak = maxf(peak, maxf(color.r, maxf(color.g, color.b)))
			print("TRANSMISSION ", index, " size=", capture.get_size(), " format=", capture.get_format(), " peak=", peak)
			capture.save_exr("/tmp/market-transmission-%d.exr" % index)
			capture.convert(Image.FORMAT_RGBA8)
			capture.save_png("/tmp/market-transmission-%d.png" % index)
	if OS.get_environment("MARKET_QA_AVATAR") == "1":
		print("PORTRAITS ", shell.avatar_gallery.images.size())
		shell.avatar_preview.viewport.get_texture().get_image().save_png("/tmp/market-native-preview-rgba.png")
		var shadow_material := shell.avatar_preview.actor.grounding_shadow.get_active_material(0)
		print("SHADOW MATERIAL ", shadow_material, " source=", SourcePbr.source_material(shell.avatar_preview.actor.grounding_shadow).albedo_color)
		if shadow_material is ShaderMaterial:
			print("SHADOW BASE ", shadow_material.get_shader_parameter("base_color"))
			FileAccess.open("/tmp/market-shadow-shader.txt", FileAccess.WRITE).store_string(shadow_material.shader.code)
			if OS.get_environment("MARKET_QA_SHADOW_PROBE") == "1":
				var opaque: ShaderMaterial = shadow_material.duplicate()
				opaque.set_shader_parameter("base_color", Color("15251f"))
				shell.avatar_preview.actor.grounding_shadow.material_override = opaque
				for index in 4: await process_frame
				await RenderingServer.frame_post_draw
				print("SHADOW OPAQUE SOURCE ", shell.avatar_preview.viewport.get_texture().get_image().get_pixel(10,410))
				for expression in ["base_color.rgb", "vec3(0.08235,0.1451,0.12157)", "OUTPUT_IS_SRGB?vec3(1,0,0):vec3(0,1,0)"]:
					var probe := Shader.new()
					probe.code = "shader_type spatial; render_mode unshaded; uniform vec4 base_color:source_color; void fragment(){ALBEDO=" + expression + ";}"
					var probe_material := ShaderMaterial.new()
					probe_material.shader = probe
					probe_material.set_shader_parameter("base_color", Color("15251f"))
					shell.avatar_preview.actor.grounding_shadow.material_override = probe_material
					await process_frame
					await RenderingServer.frame_post_draw
					print("SHADOW PROBE ", expression, " = ", shell.avatar_preview.viewport.get_texture().get_image().get_pixel(10, 410))
	canvas.free()
	world.free()
	var directory_path := store.recovery.directory
	store.free()
	var directory := DirAccess.open(directory_path)
	for file in directory.get_files(): directory.remove(file)
	DirAccess.remove_absolute(directory_path)
	NavMeshService.dispose_store_navigation()
	if viewport != root: viewport.free()
	quit()
