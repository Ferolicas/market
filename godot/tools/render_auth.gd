extends SceneTree
var failures := 0
func _init() -> void: run.call_deferred()
func run() -> void:
	if DisplayServer.get_name() == "headless":
		quit(1)
		return
	var screen := MarketAuthScreen.new()
	root.add_child(screen)
	for dimensions in [Vector2i(1280,720), Vector2i(390,844), Vector2i(360,640)]:
		root.size = dimensions
		for mode in ["login", "register", "forgot", "reset"]:
			screen._change_mode(mode)
			for frame in 12: await process_frame
			await RenderingServer.frame_post_draw
			var card := screen.card.get_global_rect()
			if card.position.x < 0 or card.end.x > root.size.x: failures += 1
			screen.scroll.scroll_vertical = 100000
			for frame in 4: await process_frame
			var submit := screen.submit_button.get_global_rect()
			if not screen.scroll.get_global_rect().encloses(submit): failures += 1
			screen.scroll.scroll_vertical = 0
			for frame in 4: await process_frame
			await RenderingServer.frame_post_draw
			root.get_texture().get_image().save_png("/tmp/market-auth-%d-%s.png" % [dimensions.x, mode])
			print("AUTH ", dimensions, " ", mode, " card ", card)
	screen.free()
	print("AUTH GPU FAILURES ", failures)
	quit(1 if failures else 0)
