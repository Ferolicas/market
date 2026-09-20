class_name AudioSettingsStore
extends RefCounted
## Port of src/game/feedback/AudioSettingsStore.ts (zustand + localStorage →
## RefCounted with a `changed` signal and a user:// file named after the
## localStorage key).

signal changed(settings: Dictionary)

const STORAGE_PATH := "user://" + AudioSettings.AUDIO_SETTINGS_KEY + ".json"

var music: float = AudioSettings.DEFAULT_AUDIO_SETTINGS.music
var effects: float = AudioSettings.DEFAULT_AUDIO_SETTINGS.effects
var vibration: bool = AudioSettings.DEFAULT_AUDIO_SETTINGS.vibration
var hydrated := false
var _storage_path: String

static var _shared: AudioSettingsStore = null

## The page-wide store (`useAudioSettings`).
static func shared() -> AudioSettingsStore:
	if _shared == null: _shared = AudioSettingsStore.new()
	return _shared

func _init(storage_path: String = STORAGE_PATH) -> void:
	_storage_path = storage_path

static func audio_settings_of(store) -> Dictionary:
	return { "music": store.music, "effects": store.effects, "vibration": store.vibration }

func settings() -> Dictionary:
	return audio_settings_of(self)

## Reads the device preference once (idempotent).
func hydrate() -> void:
	if hydrated: return
	_assign(_read_stored())
	hydrated = true

func update(change: Dictionary) -> void:
	var next := AudioSettings.normalize_audio_settings(JS.spread(settings(), change))
	_write_stored(next)
	_assign(next)

func _assign(next: Dictionary) -> void:
	music = next.music
	effects = next.effects
	vibration = next.vibration
	changed.emit(settings())

func _read_stored() -> Dictionary:
	if OS.has_feature("web") and _storage_path == STORAGE_PATH:
		var browser: Variant = JavaScriptBridge.eval("(() => { try { return localStorage.getItem(%s); } catch { return null; } })()" % JSON.stringify(AudioSettings.AUDIO_SETTINGS_KEY), true)
		if browser is String: return AudioSettings.parse_audio_settings(browser)
	if not FileAccess.file_exists(_storage_path): return AudioSettings.DEFAULT_AUDIO_SETTINGS.duplicate()
	var file := FileAccess.open(_storage_path, FileAccess.READ)
	if file == null: return AudioSettings.DEFAULT_AUDIO_SETTINGS.duplicate()
	return AudioSettings.parse_audio_settings(file.get_as_text())

func _write_stored(next: Dictionary) -> void:
	if OS.has_feature("web") and _storage_path == STORAGE_PATH:
		JavaScriptBridge.eval("try { localStorage.setItem(%s,%s); } catch {}" % [JSON.stringify(AudioSettings.AUDIO_SETTINGS_KEY), JSON.stringify(AudioSettings.serialize_audio_settings(next))], true)
	var file := FileAccess.open(_storage_path, FileAccess.WRITE)
	if file == null: return  # blocked storage: the session keeps the value
	file.store_string(AudioSettings.serialize_audio_settings(next))
