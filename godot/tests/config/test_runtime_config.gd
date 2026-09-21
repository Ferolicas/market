extends TestCase
const Config = preload("res://game/config/runtime_config.gd")
func test_versioned_flags_and_cadence() -> void:
	assert_eq(Config.CONFIG.schemaVersion, 1)
	assert_eq(Config.CONFIG.tuning.remoteSaveIntervalSeconds, 1800)
	for value in Config.CONFIG.flags.values(): assert_true(value is bool)
	var forbidden := RegEx.create_from_string("(?i)secret|password|token|credential|databaseUrl")
	assert_null(forbidden.search(JSON.stringify(Config.CONFIG)))

func test_native_api_uses_packaged_https_origin_without_environment() -> void:
	var api := MarketApi.new()
	assert_eq(ProjectSettings.get_setting("market/network/api_origin"), "https://market.olcas.app")
	assert_eq(api.base_url, "https://market.olcas.app")
	api.free()

func test_native_api_reads_configuration_instead_of_fixed_loopback() -> void:
	var original: String = ProjectSettings.get_setting("market/network/api_origin")
	ProjectSettings.set_setting("market/network/api_origin", "http://127.0.0.1:49999")
	var api := MarketApi.new()
	assert_eq(api.base_url, "http://127.0.0.1:49999")
	api.free()
	ProjectSettings.set_setting("market/network/api_origin", original)

func test_boot_splash_configuration_disables_engine_logo() -> void:
	assert_false(ProjectSettings.get_setting("application/boot_splash/show_image", true))
	assert_eq(ProjectSettings.get_setting("application/boot_splash/minimum_display_time", -1), 0)
	var bg: Color = ProjectSettings.get_setting("application/boot_splash/bg_color", Color.WHITE)
	assert_near(bg.r, 0.0509804, 0.001)
	assert_near(bg.g, 0.141176, 0.001)
	assert_near(bg.b, 0.113725, 0.001)
	var splash_path: String = ProjectSettings.get_setting("application/boot_splash/image", "")
	assert_true(ResourceLoader.exists(splash_path))

func test_market_api_detects_saved_session_presence_and_expiry() -> void:
	var temp_dir := "user://test-auth-session-" + JS.uuid()
	var api := MarketApi.new()
	api.session_directory = temp_dir
	api.base_url = "https://market.olcas.app"
	assert_false(api.has_saved_session())

	DirAccess.make_dir_recursive_absolute(temp_dir)
	var session_file := temp_dir.path_join(api.base_url.sha256_text() + ".json")
	var future_time := Time.get_unix_time_from_system() + 3600
	var file := FileAccess.open(session_file, FileAccess.WRITE)
	file.store_string(JSON.stringify({"better-auth.session_token": {"value": "valid-token", "expires": future_time}}))
	file.close()

	assert_true(api.has_saved_session())

	var past_time := Time.get_unix_time_from_system() - 3600
	file = FileAccess.open(session_file, FileAccess.WRITE)
	file.store_string(JSON.stringify({"better-auth.session_token": {"value": "expired-token", "expires": past_time}}))
	file.close()

	var api_expired := MarketApi.new()
	api_expired.session_directory = temp_dir
	api_expired.base_url = "https://market.olcas.app"
	assert_false(api_expired.has_saved_session())
	api_expired.free()

	api.free()
	var dir := DirAccess.open(temp_dir)
	if dir != null:
		for f in dir.get_files(): dir.remove(f)
		DirAccess.remove_absolute(temp_dir)

