extends TestCase

func _paddock(kind: String) -> void:
	var previous := AnimalMotion.animal_motion(kind, 0.0, true)
	var clips := {}
	for frame in range(1, 44 * 60 + 1):
		var current := AnimalMotion.animal_motion(kind, float(frame) / 60.0, true)
		assert_lt(absf(current.x), 0.23, kind)
		assert_lte(absf(current.x - previous.x), 0.005, kind)
		assert_gte(current.yaw, 0.0, kind)
		assert_lte(current.yaw, PI, kind)
		clips[current.clip] = true
		previous = current
	var expected := { "Idle": true, "Walk": true }
	expected["Graze" if kind == "cow" else "Peck"] = true
	assert_eq(clips, expected, kind)

func _stride(kind: String) -> void:
	var at0 := AnimalMotion.animal_motion(kind, 0.0, true)
	assert_near(AnimalMotion.animal_motion(kind, 0.5, true).x, at0.x + at0.speed * 0.5, 0.005, kind)
	assert_eq(AnimalMotion.animal_motion(kind, 5.0, false).clip, "Idle", kind)
	assert_eq(AnimalMotion.animal_motion(kind, 5.0, true), AnimalMotion.animal_motion(kind, 27.0, true), kind)

func test_chicken_stays_inside_its_paddock_with_continuous_translation() -> void: _paddock("chicken")
func test_cow_stays_inside_its_paddock_with_continuous_translation() -> void: _paddock("cow")
func test_chicken_keeps_stride_speed_and_does_not_feed_without_ingredients() -> void: _stride("chicken")
func test_cow_keeps_stride_speed_and_does_not_feed_without_ingredients() -> void: _stride("cow")
