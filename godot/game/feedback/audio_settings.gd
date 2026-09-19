class_name AudioSettings
extends RefCounted
## Port of src/game/feedback/AudioSettings.ts.
## Sound preferences live on the device, never in the save: they are not
## part of the game and the server schema rejects unknown fields.
## Settings Dictionary: { music: 0..1, effects: 0..1, vibration: bool }.

const AUDIO_SETTINGS_KEY := "mini-market-audio-v1"
const DEFAULT_AUDIO_SETTINGS := { "music": 0.6, "effects": 0.8, "vibration": true }

static func _level(value: Variant, fallback: float) -> float:
	# A missing key is JS `undefined` (Number → NaN), not `null` (Number → 0).
	if value == null: return fallback
	var parsed := JS.to_number(value)
	return minf(1.0, maxf(0.0, float(JS.round(parsed * 100.0)) / 100.0)) if is_finite(parsed) else fallback

static func normalize_audio_settings(input: Variant) -> Dictionary:
	var raw: Dictionary = input if input is Dictionary else {}
	return {
		"music": _level(raw.get("music"), DEFAULT_AUDIO_SETTINGS.music),
		"effects": _level(raw.get("effects"), DEFAULT_AUDIO_SETTINGS.effects),
		"vibration": raw.vibration if raw.get("vibration") is bool else DEFAULT_AUDIO_SETTINGS.vibration,
	}

static func parse_audio_settings(serialized: Variant) -> Dictionary:
	if serialized == null or serialized == "": return DEFAULT_AUDIO_SETTINGS.duplicate()
	var json := JSON.new()
	if json.parse(serialized) != OK: return DEFAULT_AUDIO_SETTINGS.duplicate()
	return normalize_audio_settings(json.data)

static func serialize_audio_settings(settings: Dictionary) -> String:
	return JSON.stringify(normalize_audio_settings(settings))

## Slider position to gain: squared so half way sounds half as loud instead of a quarter.
static func volume_gain(level_value: float) -> float:
	var clamped := minf(1.0, maxf(0.0, level_value if is_finite(level_value) else 0.0))
	return clamped * clamped
