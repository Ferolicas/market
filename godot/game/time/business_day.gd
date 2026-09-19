class_name BusinessDay
extends RefCounted
## Port of src/game/time/BusinessDay.ts.

const BUSINESS_DAY_OPEN_MINUTE := 7 * 60 + 30
const BUSINESS_DAY_DUSK_MINUTE := 18 * 60
const BUSINESS_DAY_NIGHT_MINUTE := 21 * 60
const BUSINESS_DAY_GAME_MINUTES := BUSINESS_DAY_NIGHT_MINUTE - BUSINESS_DAY_OPEN_MINUTE
const BUSINESS_DAY_REAL_DURATION_MS := 3 * 60 * 60 * 1000

static func business_minutes_for_real_ms(real_ms: Variant) -> float:
	var bounded_ms: float = maxf(0.0, float(real_ms)) if JS.is_finite_number(real_ms) else 0.0
	return bounded_ms * BUSINESS_DAY_GAME_MINUTES / BUSINESS_DAY_REAL_DURATION_MS

static func business_day_is_closing(minute_of_day: float) -> bool:
	return minute_of_day >= BUSINESS_DAY_NIGHT_MINUTE

## DaylightPresentation: { background: String, fog: String, ambientIntensity: float, keyIntensity: float, keyColor: String, phase: "day"|"sunset"|"night" }

const DAY := { "background": "#b8dfce", "ambient": 1.15, "key": 2.3, "keyColor": "#fff6df" }
const SUNSET := { "background": "#d69b78", "ambient": 0.72, "key": 1.45, "keyColor": "#ffc18b" }
const NIGHT := { "background": "#172942", "ambient": 0.34, "key": 0.48, "keyColor": "#9db9e8" }

static func daylight_presentation(minute_of_day: float) -> Dictionary:
	if minute_of_day <= BUSINESS_DAY_DUSK_MINUTE:
		return { "background": DAY["background"], "fog": DAY["background"], "ambientIntensity": DAY["ambient"], "keyIntensity": DAY["key"], "keyColor": DAY["keyColor"], "phase": "day" }
	if minute_of_day >= BUSINESS_DAY_NIGHT_MINUTE:
		return { "background": NIGHT["background"], "fog": NIGHT["background"], "ambientIntensity": NIGHT["ambient"], "keyIntensity": NIGHT["key"], "keyColor": NIGHT["keyColor"], "phase": "night" }

	var dusk_progress: float = (minute_of_day - BUSINESS_DAY_DUSK_MINUTE) / float(BUSINESS_DAY_NIGHT_MINUTE - BUSINESS_DAY_DUSK_MINUTE)
	var first_half := dusk_progress <= 0.5
	var local_progress := _smooth_step(dusk_progress * 2 if first_half else (dusk_progress - 0.5) * 2)
	var from: Dictionary = DAY if first_half else SUNSET
	var to: Dictionary = SUNSET if first_half else NIGHT
	var background := _interpolate_hex(from["background"], to["background"], local_progress)
	return {
		"background": background,
		"fog": background,
		"ambientIntensity": _lerp(from["ambient"], to["ambient"], local_progress),
		"keyIntensity": _lerp(from["key"], to["key"], local_progress),
		"keyColor": _interpolate_hex(from["keyColor"], to["keyColor"], local_progress),
		"phase": "sunset",
	}

static func _smooth_step(value: float) -> float:
	var bounded := clampf(value, 0.0, 1.0)
	return bounded * bounded * (3 - 2 * bounded)

static func _lerp(from: float, to: float, progress: float) -> float:
	return from + (to - from) * progress

static func _interpolate_hex(from: String, to: String, progress: float) -> String:
	var from_value := from.substr(1).hex_to_int()
	var to_value := to.substr(1).hex_to_int()
	var channel := func(shift: int) -> int: return JS.round(_lerp((from_value >> shift) & 255, (to_value >> shift) & 255, progress))
	return "#%02x%02x%02x" % [channel.call(16), channel.call(8), channel.call(0)]
