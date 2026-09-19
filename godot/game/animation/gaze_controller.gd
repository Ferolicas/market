class_name GazeController
extends RefCounted
## Port of src/game/animation/GazeController.ts.
## mode: "forward" | "browse" | "queue" | "phone" | "checkout". Returns { yaw, pitch }.

var _seed: int

func _init(seed_value: int) -> void:
	_seed = seed_value

func sample(elapsed: float, mode: String) -> Dictionary:
	var phase := elapsed * (0.42 + float(_seed % 7) * 0.017) + float(_seed) * 0.73
	var scale := 0.24 if mode == "browse" else (0.18 if mode == "queue" else (0.1 if mode == "checkout" else 0.055))
	var yaw := maxf(-0.35, minf(0.35, sin(phase) * scale))
	var pitch_target := 0.22 if mode == "phone" else (0.06 if mode == "browse" else (0.08 if mode == "checkout" else 0.0))
	return { "yaw": yaw, "pitch": maxf(-0.18, minf(0.28, pitch_target + sin(phase * 0.61) * 0.025)) }
