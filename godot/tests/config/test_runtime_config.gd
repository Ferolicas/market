extends TestCase
const Config = preload("res://game/config/runtime_config.gd")
func test_versioned_flags_and_cadence() -> void:
	assert_eq(Config.CONFIG.schemaVersion, 1)
	assert_eq(Config.CONFIG.tuning.remoteSaveIntervalSeconds, 1800)
	for value in Config.CONFIG.flags.values(): assert_true(value is bool)
	var forbidden := RegEx.create_from_string("(?i)secret|password|token|credential|databaseUrl")
	assert_null(forbidden.search(JSON.stringify(Config.CONFIG)))
