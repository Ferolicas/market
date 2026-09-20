class_name TestCase
extends RefCounted
## Minimal test base for headless runs. Subclasses define `test_*` methods.
## Assertions record failures instead of aborting so one run reports everything.

var _failures: Array[String] = []
var _current := ""
var error_count: Callable = Callable()
var error_collector: Variant = null

func before_each() -> void: pass
func after_each() -> void: pass

func fail(message: String) -> void:
	_failures.append("%s: %s" % [_current, message])

func assert_true(value: bool, message := "") -> void:
	if not value: fail("expected true. %s" % message)

func assert_false(value: bool, message := "") -> void:
	if value: fail("expected false. %s" % message)

func assert_eq(actual, expected, message := "") -> void:
	if not _deep_eq(actual, expected): fail("expected %s but got %s. %s" % [_fmt(expected), _fmt(actual), message])

func assert_ne(actual, expected, message := "") -> void:
	if _deep_eq(actual, expected): fail("expected values to differ: %s. %s" % [_fmt(actual), message])

func assert_near(actual: float, expected: float, tolerance := 1e-6, message := "") -> void:
	if absf(actual - expected) > tolerance: fail("expected %s ≈ %s (±%s). %s" % [actual, expected, tolerance, message])

func assert_gt(actual, expected, message := "") -> void:
	if not (actual > expected): fail("expected %s > %s. %s" % [actual, expected, message])

func assert_gte(actual, expected, message := "") -> void:
	if not (actual >= expected): fail("expected %s >= %s. %s" % [actual, expected, message])

func assert_lt(actual, expected, message := "") -> void:
	if not (actual < expected): fail("expected %s < %s. %s" % [actual, expected, message])

func assert_lte(actual, expected, message := "") -> void:
	if not (actual <= expected): fail("expected %s <= %s. %s" % [actual, expected, message])

func assert_null(value, message := "") -> void:
	if value != null: fail("expected null but got %s. %s" % [_fmt(value), message])

func assert_not_null(value, message := "") -> void:
	if value == null: fail("expected non-null. %s" % message)

func assert_contains(collection, item, message := "") -> void:
	if collection is String:
		if not (collection as String).contains(str(item)): fail("expected '%s' to contain '%s'. %s" % [collection, item, message])
	elif collection is Dictionary:
		if not collection.has(item): fail("expected dictionary to have key %s. %s" % [_fmt(item), message])
	else:
		var found := false
		for element in collection:
			if _deep_eq(element, item): found = true; break
		if not found: fail("expected %s to contain %s. %s" % [_fmt(collection), _fmt(item), message])

func assert_has_keys(dict: Dictionary, keys: Array, message := "") -> void:
	for key in keys:
		if not dict.has(key): fail("expected key %s in %s. %s" % [key, _fmt(dict), message])

func _deep_eq(a, b) -> bool:
	if a is float or b is float:
		if (a is float or a is int) and (b is float or b is int): return is_equal_approx(float(a), float(b))
		return false
	if a is Array and b is Array:
		if a.size() != b.size(): return false
		for i in a.size():
			if not _deep_eq(a[i], b[i]): return false
		return true
	if a is Dictionary and b is Dictionary:
		if a.size() != b.size(): return false
		for k in a:
			if not b.has(k) or not _deep_eq(a[k], b[k]): return false
		return true
	return a == b

func _fmt(value) -> String:
	var text := JSON.stringify(value) if (value is Dictionary or value is Array) else str(value)
	return text if text.length() < 400 else text.substr(0, 400) + "…"

func _run_all() -> Dictionary:
	var passed := 0
	for method in get_method_list():
		var name: String = method.name
		if not name.begins_with("test_"): continue
		_current = name
		var before := _failures.size()
		var errors_before: int = error_count.call() if error_count.is_valid() else 0
		print("CASE START ", get_script().resource_path, "::", name)
		await before_each()
		await call(name)
		await after_each()
		print("CASE END ", get_script().resource_path, "::", name)
		if error_count.is_valid() and error_count.call() > errors_before:
			fail("Godot runtime error; see engine log")
		if _failures.size() == before: passed += 1
	return { "passed": passed, "failures": _failures }

## Equivalent of TS expect(fn).toThrow(message), with exact error accounting.
func assert_engine_error(message: String, action: Callable) -> Variant:
	if error_collector == null:
		fail("Missing engine error collector")
		return null
	var previous: int = error_collector.count()
	print("EXPECTED ERROR START ", JSON.stringify(message))
	var value = action.call()
	var matched: bool = error_collector.consume_expected(message, previous)
	print("EXPECTED ERROR END ", "VERIFIED" if matched else "MISMATCH")
	assert_true(matched, "Expected exactly one engine error: " + message)
	return value
