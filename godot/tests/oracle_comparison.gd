extends RefCounted
## UUID spelling is nondeterministic, but identity and every reference must match.
static func canonical(value: Variant) -> Variant:
	return _canonical(value, {}, RegEx.create_from_string("(?i)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"))

static func _canonical(value: Variant, ids: Dictionary, regex: RegEx) -> Variant:
	if value is String:
		var result: String = value
		for match_value in regex.search_all(value):
			var id := match_value.get_string()
			if id not in ids: ids[id] = "<uuid-%d>" % ids.size()
			result = result.replace(id, ids[id])
		return result
	if value is Array:
		var result: Array = []
		for item in value: result.append(_canonical(item, ids, regex))
		return result
	if value is Dictionary:
		var result := {}
		# Sort keys so object insertion order has no influence on UUID mapping.
		var keys: Array = value.keys()
		keys.sort()
		for key in keys: result[key] = _canonical(value[key], ids, regex)
		return result
	return value

static func difference(actual: Variant, expected: Variant, path: String = "$") -> String:
	if actual is Dictionary and expected is Dictionary:
		for key in expected:
			if key not in actual: return path + "." + key + " missing"
			var diff := difference(actual[key], expected[key], path + "." + key)
			if diff != "": return diff
		for key in actual:
			if key not in expected: return path + "." + key + " unexpected"
		return ""
	if actual is Array and expected is Array:
		if actual.size() != expected.size(): return "%s size: %d != %d" % [path, actual.size(), expected.size()]
		for index in actual.size():
			var diff := difference(actual[index], expected[index], "%s[%d]" % [path, index])
			if diff != "": return diff
		return ""
	if actual == expected: return ""
	if (actual is float or actual is int) and (expected is float or expected is int):
		# Decimal JSON parsing and double arithmetic may differ by one ULP.
		# Tolerance is confined to continuous geometry/time/energy fields.
		var continuous := ["x", "z", "targetX", "targetZ", "currentSpeed", "speed", "energy", "minuteOfDay", "businessMinute", "lastServerTime", "readyAt", "plantedAt", "startedAt", "completesAt", "doorProgress"]
		if (path.get_slice(".", path.get_slice_count(".") - 1) in continuous or ".path[" in path) and absf(actual - expected) <= 1e-8: return ""
		return "%s: %.17f != %.17f" % [path, actual, expected]
	return "%s: %s != %s" % [path, str(actual), str(expected)]
