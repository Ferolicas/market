extends TestCase

func test_round_matches_javascript() -> void:
	assert_eq(JS.round(2.5), 3)
	assert_eq(JS.round(-2.5), -2)
	assert_eq(JS.round(0.49), 0)

func test_find_and_slice() -> void:
	assert_eq(JS.find([1, 2, 3], func(v): return v > 1), 2)
	assert_null(JS.find([1], func(v): return v > 1))
	assert_eq(JS.slice([1, 2, 3, 4], 1, -1), [2, 3])
	assert_eq(JS.slice([1, 2, 3], -2), [2, 3])

func test_pad_and_fixed() -> void:
	assert_eq(JS.pad_start("7", 3), "007")
	assert_eq(JS.to_fixed(1.005, 2), "1.00")
