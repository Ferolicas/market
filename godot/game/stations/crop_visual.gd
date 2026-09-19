class_name CropVisual
extends RefCounted
## Port of src/game/stations/crop-visual.ts.

static func _non_negative_integer(value: Variant) -> int:
	return maxi(0, JS.floor(float(value))) if JS.is_finite_number(value) else 0

## Selects evenly distributed, deterministic fruit slots for the remaining
## harvest. A full bed uses every authored slot; a partial bed preserves the
## same density ratio without bunching all remaining produce into one corner.
static func crop_visual_slot_indices(available_input: Variant, yield_capacity_input: Variant, slot_count_input: Variant) -> Array:
	var available := _non_negative_integer(available_input)
	var slot_count := _non_negative_integer(slot_count_input)
	if available < 1 or slot_count < 1: return []

	var yield_capacity: int = JS.max_of([1, _non_negative_integer(yield_capacity_input), available])
	var visible_count := mini(slot_count, maxi(1, JS.round(float(slot_count * available) / yield_capacity)))
	var indices := []
	if visible_count == slot_count:
		for index in slot_count: indices.append(index)
		return indices

	for index in visible_count:
		indices.append(mini(slot_count - 1, JS.floor((index + 0.5) * slot_count / visible_count)))
	return indices
