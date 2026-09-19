class_name FootGroundingController
extends RefCounted
## Port of src/game/animation/FootGroundingController.ts.

var _sole_clearance: Variant = null

func calibrate(lowest_foot_world_y: float, ground_world_y: float) -> void:
	if _sole_clearance == null and is_finite(lowest_foot_world_y):
		_sole_clearance = maxf(0.0, lowest_foot_world_y - ground_world_y)

func solve(lowest_foot_world_y: float, ground_world_y: float, support_weight: float) -> float:
	if _sole_clearance == null or support_weight <= 0.0: return 0.0
	var error: float = ground_world_y + _sole_clearance - lowest_foot_world_y
	return maxf(-0.03, minf(0.03, error * minf(1.0, support_weight)))

func reset() -> void:
	_sole_clearance = null
