extends TestCase
const Loop = preload("res://game/core/game_loop.gd")

func test_ticks_at_60_hz_independently_of_render_cadence() -> void:
	var loop = Loop.new(1.0 / 60, 5)
	var ticks: Array = []
	loop.advance(0, func(step): ticks.append(step))
	loop.advance(1.0 / 30, func(step): ticks.append(step))
	assert_eq(ticks.size(), 2)
	assert_near(ticks[0], 1.0 / 60)

func test_caps_substeps_after_a_stalled_frame() -> void:
	var loop = Loop.new(1.0 / 60, 4)
	var ticks: Array = []
	loop.advance(0, func(step): ticks.append(step))
	var stats: Dictionary = loop.advance(2, func(step): ticks.append(step))
	assert_eq(stats.steps, 4)
	assert_gt(stats.droppedSeconds, 1.9)

func test_reset_and_backward_clock_do_not_replay_old_steps() -> void:
	var loop = Loop.new()
	var ticks: Array = []
	var tick := func(step): ticks.append(step)
	loop.advance(10, tick)
	assert_eq(loop.advance(9, tick).steps, 0)
	loop.reset()
	assert_eq(loop.advance(100, tick).steps, 0)
	# TS oracle yields one step here due to subtraction at t=100.
	var result: Dictionary = loop.advance(100 + 1.0 / 30, tick)
	assert_eq(result.steps, 1)
	assert_near(result.alpha, 0.9999999999998863, 1e-12)
