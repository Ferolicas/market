extends TestCase

func test_iphone_points_preserve_responsive_breakpoints() -> void:
	assert_eq(MarketDisplayMetrics.logical_size(Vector2i(1290, 2796), 3), Vector2i(430, 932))
	assert_eq(MarketDisplayMetrics.logical_size(Vector2i(1170, 2532), 3), Vector2i(390, 844))
	assert_eq(MarketDisplayMetrics.logical_size(Vector2i(750, 1334), 2), Vector2i(375, 667))
	assert_eq(MarketDisplayMetrics.logical_size(Vector2i(1280, 720), 1), Vector2i(1280, 720))

func test_native_safe_area_converts_pixels_without_changing_camera_viewport() -> void:
	assert_eq(MarketSafeArea.native_insets(Vector2(1290, 2796), Rect2(0, 177, 1290, 2517), Vector2(430, 932)), Vector4(0, 59, 0, 34))
	assert_eq(MarketSafeArea.native_insets(Vector2(750, 1334), Rect2(0, 0, 750, 1334), Vector2(375, 667)), Vector4.ZERO)
	assert_eq(MarketSafeArea.native_insets(Vector2(2796, 1290), Rect2(177, 0, 2442, 1227), Vector2(932, 430)), Vector4(59, 0, 59, 21))

func test_ios_configuration_locks_portrait_without_changing_web_desktop() -> void:
	var config := ConfigFile.new()
	assert_eq(config.load("res://project.godot"), OK)
	assert_eq(config.get_value("display", "window/handheld/orientation.ios"), DisplayServer.SCREEN_PORTRAIT)
	assert_eq(config.get_value("display", "window/stretch/mode.ios"), "canvas_items")
	assert_eq(config.get_value("display", "window/stretch/aspect.ios"), "ignore")

func test_retina_window_retains_full_portrait_world_and_logical_ui() -> void:
	var window: Window = Engine.get_main_loop().root
	var previous := {"size": window.size, "logical": window.content_scale_size, "mode": window.content_scale_mode, "aspect": window.content_scale_aspect}
	window.size = Vector2i(1290, 2796)
	window.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
	window.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_IGNORE
	window.content_scale_size = MarketDisplayMetrics.logical_size(window.size, 3)
	for frame in 2: await Engine.get_main_loop().process_frame
	assert_eq(window.size, Vector2i(1290, 2796))
	assert_eq(window.get_visible_rect().size, Vector2(430, 932))
	assert_near(window.get_final_transform().x.x, 3, 0.00001)
	assert_near(window.get_final_transform().y.y, 3, 0.00001)
	window.content_scale_mode = previous.mode
	window.content_scale_aspect = previous.aspect
	window.content_scale_size = previous.logical
	window.size = previous.size
