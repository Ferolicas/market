extends SceneTree
## Actual GPU regression for AvatarCustomizer/AvatarThumbnails composition.
## Source reference: node scripts/export-godot-scene.mjs preview-reference.
var failures := 0

func _init() -> void: run.call_deferred()

func check(condition: bool, message: String) -> void:
	if not condition:
		failures += 1
		printerr("FAIL: ", message)

func run() -> void:
	if DisplayServer.get_name() == "headless":
		printerr("FAIL: this test requires a real GPU renderer")
		quit(1)
		return
	var background := ColorRect.new()
	background.color = Color("fffaef")
	background.size = Vector2(355, 520)
	root.add_child(background)
	var preview := MarketAvatarPreview.new()
	preview.size = Vector2(355, 520)
	preview.config = MarketEngine.create_campaign_game().avatar
	root.add_child(preview)
	var gallery := MarketAvatarGallery.new()
	root.add_child(gallery)
	gallery.request("body", preview.config, "body", Callable())
	for frame in 120: await process_frame
	await RenderingServer.frame_post_draw
	var capture := preview.viewport.get_texture().get_image()
	check(capture.get_size() == Vector2i(355, 520), "Actual preview render size")
	check(capture.get_pixel(0, 0).is_equal_approx(Color(0, 0, 0, 0)), "Transparent clear must contain zero RGB")
	var composited := root.get_texture().get_image().get_pixel(10, 410)
	# Original React canvas on #fffaef: RGB 205,204,194 at the ellipse edge.
	var expected := Color8(205, 204, 194)
	for component in 3:
		check(absf(composited[component] - expected[component]) <= 2.0 / 255.0, "Source shadow colour channel %d: %s" % [component, composited])
	check(gallery.images.has("body"), "Actual rig portrait must complete")
	if gallery.images.has("body"):
		var portrait: Image = gallery.images.body.get_image()
		check(portrait.get_pixel(0, 0).is_equal_approx(Color(0, 0, 0, 0)), "Portrait transparent clear")
		var translucent := 0
		var opaque := 0
		for y in portrait.get_height():
			for x in portrait.get_width():
				var pixel := portrait.get_pixel(x, y)
				if pixel.a > 0.99: opaque += 1
				elif pixel.a > 0.01: translucent += 1
		check(opaque > 100, "Portrait contains the rendered character")
		check(translucent > 100, "Portrait preserves translucent shadow and antialiasing")
	print("GPU PRESENTATION shadow=", composited, " rgba=", capture.get_pixel(10,410), " renderer=", RenderingServer.get_current_rendering_method(), " failures=", failures)
	preview.free()
	gallery.free()
	background.free()
	quit(1 if failures else 0)
