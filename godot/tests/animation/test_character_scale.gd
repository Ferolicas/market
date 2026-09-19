extends TestCase

func test_keeps_the_currently_approved_child_scale_as_the_minimum() -> void:
	assert_eq(CharacterScale.character_scene_scale("boy"), CharacterScale.CHILD_CHARACTER_SCENE_SCALE)
	assert_eq(CharacterScale.character_scene_scale("girl"), CharacterScale.CHILD_CHARACTER_SCENE_SCALE)
	assert_eq(CharacterScale.character_scene_scale("adult-man"), CharacterScale.ADULT_CHARACTER_SCENE_SCALE)
	assert_eq(CharacterScale.character_scene_scale("adult-woman"), CharacterScale.ADULT_CHARACTER_SCENE_SCALE)
	assert_near(CharacterScale.CHILD_CHARACTER_SCENE_SCALE / CharacterScale.ADULT_CHARACTER_SCENE_SCALE, 0.9, 0.005)

func test_preserves_each_customer_model_calibration_while_matching_the_adult_cast() -> void:
	assert_near(CharacterScale.adult_customer_scene_scale(1.236) / CharacterScale.adult_customer_scene_scale(1.226), 1.236 / 1.226, 0.005)
	assert_near(CharacterScale.adult_customer_scene_scale(1.1), CharacterScale.ADULT_CHARACTER_SCENE_SCALE, 0.005)
