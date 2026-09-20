extends TestCase
const Access = preload("res://game/debug/qa_access.gd")
func test_public_flags_cannot_enable_qa() -> void:
	assert_false(Access.market_qa_query_enabled("?debug=1", false))
	assert_false(Access.market_performance_probe_enabled("?perf=1", false))
	assert_false(Access.market_qa_freeze_enabled("?perf-freeze=1&debug=1", "1", false))
func test_explicit_qa_builds() -> void:
	assert_true(Access.market_qa_query_enabled("?debug=1", true))
	assert_true(Access.market_performance_probe_enabled("?perf=1", true))
	assert_true(Access.market_qa_freeze_enabled("?debug=1", "1", true))
	assert_false(Access.market_qa_freeze_enabled("?debug=1", null, true))
	assert_true(Access.market_qa_freeze_enabled("?perf-freeze=1", null, true))
