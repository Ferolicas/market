extends SceneTree
## Render every native management panel at actual desktop and phone sizes.
var failures := 0
func _init() -> void: run.call_deferred()
func check(value: bool, message: String) -> void:
	if not value:
		failures += 1
		printerr("FAIL: ", message)
func run() -> void:
	if DisplayServer.get_name() == "headless":
		quit(1)
		return
	var store := MarketStore.new()
	store.recovery = RecoveryStorage.new()
	store.recovery.directory = "user://panels-qa-" + JS.uuid()
	store.add_child(store.recovery)
	root.add_child(store)
	store.game = MarketEngine.create_campaign_game()
	store.game.tutorialStep = 1
	var world := MarketWorld.new()
	world.store = store
	root.add_child(world)
	var canvas := CanvasLayer.new()
	root.add_child(canvas)
	var shell := MarketGameShell.new()
	shell.store = store
	shell.world = world
	canvas.add_child(shell)
	for dimensions in [Vector2i(1280,720), Vector2i(390,844), Vector2i(360,640)]:
		root.size = dimensions
		for frame in 5: await process_frame
		for panel in ["stock", "orders", "team", "map", "finance", "settings", "help", "avatar"]:
			shell.open_panel(panel)
			for frame in (100 if panel == "avatar" else 20): await process_frame
			await RenderingServer.frame_post_draw
			var card: Control = shell.overlay.get_node("ManagementPanel")
			var bounds := Rect2(Vector2.ZERO, root.get_visible_rect().size)
			var actual := card.get_global_rect()
			check(bounds.grow(1).encloses(actual), "%s %s panel outside viewport: %s" % [dimensions,panel,actual])
			var close: Button = card.find_child("ClosePanel", true, false)
			check(bounds.encloses(close.get_global_rect()), "Close control remains visible")
			var before := close.get_global_rect()
			shell.panel_scroll.scroll_vertical = 100000
			for frame in 3: await process_frame
			check(close.get_global_rect() == before, "Close control does not scroll away")
			check(not world.driveable, "Panel captures movement")
			shell.panel_scroll.scroll_vertical = 0
			for frame in 3: await process_frame
			await RenderingServer.frame_post_draw
			root.get_texture().get_image().save_png("/tmp/market-panel-%d-%s.png" % [dimensions.x,panel])
			close.pressed.emit()
			check(shell.panel.is_empty() and world.driveable, "Close restores movement")
			print("PANEL ", dimensions, " ", panel, " ", actual)
	canvas.free()
	world.free()
	var directory_path := store.recovery.directory
	store.free()
	if DirAccess.dir_exists_absolute(directory_path):
		var directory := DirAccess.open(directory_path)
		for file in directory.get_files(): directory.remove(file)
		DirAccess.remove_absolute(directory_path)
	NavMeshService.dispose_store_navigation()
	print("PANEL GPU FAILURES ", failures)
	quit(1 if failures else 0)
