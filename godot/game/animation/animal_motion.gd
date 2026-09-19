class_name AnimalMotion
extends RefCounted
## Port of src/game/animation/AnimalMotion.ts.
## kind: "chicken" | "cow"; clip: "Idle" | "Walk" | "Peck" | "Graze".

## Short lane in front of the shelter; movement has one visual owner.
static func animal_motion(kind: String, seconds: float, active: bool) -> Dictionary:
	var duration := 1.3 if kind == "cow" else 0.8
	var stride := 0.075 if kind == "cow" else 0.055
	var speed := 4.0 * stride / duration
	var distance := speed * 1.6
	var phase := fmod(fmod(seconds, 22.0) + 22.0, 22.0)
	var x := -distance / 2.0
	var yaw := 0.0
	var clip := ("Graze" if kind == "cow" else "Peck") if active else "Idle"
	if phase < 1.6:
		x += speed * phase
		clip = "Walk"
	elif phase < 10.0:
		x = distance / 2.0
	elif phase < 11.0:
		x = distance / 2.0
		yaw = PI * (phase - 10.0)
		clip = "Idle"
	elif phase < 12.6:
		x = distance / 2.0 - speed * (phase - 11.0)
		yaw = PI
		clip = "Walk"
	elif phase < 21.0:
		yaw = PI
	else:
		yaw = PI * (22.0 - phase)
		clip = "Idle"
	return { "x": x, "yaw": yaw, "clip": clip, "speed": speed if clip == "Walk" else 0.0 }
