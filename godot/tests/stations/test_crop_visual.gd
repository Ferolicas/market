extends TestCase
## Port of src/game/stations/crop-visual.test.ts

func test_reduces_a_tier_ten_bed_deterministically_from_7_to_2_to_0_remaining_units() -> void:
	var full := CropVisual.crop_visual_slot_indices(7, 7, 28)
	var partial := CropVisual.crop_visual_slot_indices(2, 7, 28)
	var empty := CropVisual.crop_visual_slot_indices(0, 7, 28)

	assert_eq(full, range(28))
	assert_eq(partial, [1, 5, 8, 12, 15, 19, 22, 26])
	assert_eq(CropVisual.crop_visual_slot_indices(2, 7, 28), partial)
	assert_eq(empty, [])

func test_clamps_malformed_and_over_capacity_snapshots_without_duplicate_slots() -> void:
	assert_eq(CropVisual.crop_visual_slot_indices(NAN, 7, 28), [])
	assert_eq(CropVisual.crop_visual_slot_indices(-2, 7, 28), [])
	assert_eq(CropVisual.crop_visual_slot_indices(9, 7, 4), [0, 1, 2, 3])
