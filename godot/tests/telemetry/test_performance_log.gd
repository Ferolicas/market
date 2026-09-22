extends TestCase
const Log = preload("res://game/telemetry/performance_log.gd")

func before_each() -> void:
	Log.take_all_unflushed() # drain any leftovers from other tests/production code this session

func test_ignores_operations_under_the_one_frame_threshold() -> void:
	Log.record("cheap_thing", 5)
	assert_eq(Log.take_batch(), [])

func test_records_a_slow_operation_with_its_context_as_one_compact_line() -> void:
	Log.record("sync_state", 143, {"customers": 11, "employees": 16})
	var batch := Log.take_batch()
	assert_eq(batch.size(), 1)
	assert_contains(batch[0], "sync_state")
	assert_contains(batch[0], "143ms")
	assert_contains(batch[0], "customers=11")
	assert_contains(batch[0], "employees=16")

func test_marks_a_lifecycle_event_with_no_duration() -> void:
	Log.mark("background")
	var batch := Log.take_batch()
	assert_eq(batch.size(), 1)
	assert_contains(batch[0], "background")

func test_take_batch_advances_the_cursor_without_re_sending_old_lines() -> void:
	Log.record("a", 100)
	Log.record("b", 100)
	Log.record("c", 100)
	var first := Log.take_batch(2)
	assert_eq(first.size(), 2)
	assert_true(Log.has_unflushed())
	var second := Log.take_batch(2)
	assert_eq(second.size(), 1)
	assert_false(Log.has_unflushed())
	assert_eq(Log.take_batch(), [])

func test_take_all_unflushed_drains_everything_for_a_final_shutdown_flush() -> void:
	for i in 20: Log.record("op", 100)
	var all := Log.take_all_unflushed()
	assert_eq(all.size(), 20)
	assert_false(Log.has_unflushed())
