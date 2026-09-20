class_name QaAccess
extends RefCounted
## src/game/debug/QaAccess.ts. Release builds must explicitly opt into QA.
static var MARKET_QA_BUILD_ENABLED: bool = OS.is_debug_build() or OS.has_feature("market_qa")

static func market_qa_query_enabled(search: String, enabled: bool = MARKET_QA_BUILD_ENABLED) -> bool:
	return enabled and JS.url_search_params(search).has("debug")

static func market_performance_probe_enabled(search: String, enabled: bool = MARKET_QA_BUILD_ENABLED) -> bool:
	return enabled and JS.url_search_params(search).has("perf")

static func market_performance_baseline_enabled(search: String, enabled: bool = MARKET_QA_BUILD_ENABLED) -> bool:
	var params := JS.url_search_params(search)
	return enabled and params.has("perf") and params.has("perf-baseline")

static func market_qa_freeze_enabled(search: String, freeze_token: Variant, enabled: bool = MARKET_QA_BUILD_ENABLED) -> bool:
	var params := JS.url_search_params(search)
	return enabled and (params.has("perf-freeze") or (params.has("debug") and freeze_token == "1"))
