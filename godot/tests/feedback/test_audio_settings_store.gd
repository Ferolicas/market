extends TestCase

const PATH := "user://test-mini-market-audio-v1.json"

func before_each() -> void:
	if FileAccess.file_exists(PATH): DirAccess.remove_absolute(ProjectSettings.globalize_path(PATH))

func after_each() -> void: before_each()

func test_hydrates_defaults_persists_updates_and_emits_changes() -> void:
	var store := AudioSettingsStore.new(PATH)
	var seen := []
	store.changed.connect(func(settings): seen.append(settings))
	store.hydrate()
	assert_true(store.hydrated)
	assert_eq(store.settings(), AudioSettings.DEFAULT_AUDIO_SETTINGS)
	store.update({ "music": 0.333, "vibration": false })
	assert_eq(store.settings(), { "music": 0.33, "effects": 0.8, "vibration": false })
	assert_eq(seen.size(), 2)
	var reloaded := AudioSettingsStore.new(PATH)
	reloaded.hydrate()
	assert_eq(reloaded.settings(), { "music": 0.33, "effects": 0.8, "vibration": false })
	assert_eq(AudioSettingsStore.audio_settings_of(reloaded), reloaded.settings())
