class_name FacialController
extends RefCounted
## Port of src/game/animation/FacialController.ts.
## expression: "Neutral" | "Happy" | "Impatient" | "Confused" | "Surprise".
## Returns morph-target (blend shape) weights by name.

var _blink_interval: float

func _init(seed_value: float) -> void:
	_blink_interval = 2.5 + _seeded(seed_value) * 3.5

func weights(time_seconds: float, expression: String) -> Dictionary:
	var blink_duration := 0.14
	var blink_phase := fmod(time_seconds, _blink_interval)
	var blink := sin(blink_phase / blink_duration * PI) if blink_phase < blink_duration else 0.0
	var values := { "Blink_L": blink, "Blink_R": blink }
	if expression == "Happy": values.merge({ "Smile": 0.75, "CheekUp": 0.45, "BrowUp_L": 0.1, "BrowUp_R": 0.1 }, true)
	if expression == "Impatient": values.merge({ "BrowDown_L": 0.35, "BrowDown_R": 0.35, "Frown": 0.45 }, true)
	if expression == "Confused": values.merge({ "BrowUp_L": 0.45, "BrowDown_R": 0.2, "MouthNarrow": 0.25, "Confused": 0.72 }, true)
	if expression == "Surprise": values.merge({ "EyeWide_L": 0.65, "EyeWide_R": 0.65, "BrowUp_L": 0.7, "BrowUp_R": 0.7, "JawOpen": 0.35, "Surprise": 0.7 }, true)
	return values

static func _seeded(seed_value: float) -> float:
	var value := sin(seed_value * 12.9898) * 43758.5453
	return value - floorf(value)
