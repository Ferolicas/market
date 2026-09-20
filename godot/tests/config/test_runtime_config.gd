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
