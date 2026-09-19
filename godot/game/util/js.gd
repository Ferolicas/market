class_name JS
extends RefCounted
## Helpers reproducing JavaScript/TypeScript semantics used by the original
## engine so ported code keeps identical numeric and collection behaviour.

## Math.round: halves round towards +infinity (JS), unlike GDScript's round().
static func round(value: float) -> int:
	return int(floor(value + 0.5))

## Math.trunc
static func trunc(value: float) -> int:
	return int(value)

## Math.floor / Math.ceil returning ints.
static func floor(value: float) -> int:
	return int(floorf(value))

static func ceil(value: float) -> int:
	return int(ceilf(value))

## Math.hypot(a, b)
static func hypot(a: float, b: float) -> float:
	return sqrt(a * a + b * b)

## Math.max / Math.min over any count of numbers.
static func max_of(values: Array) -> Variant:
	var best = values[0]
	for value in values:
		if value > best: best = value
	return best

static func min_of(values: Array) -> Variant:
	var best = values[0]
	for value in values:
		if value < best: best = value
	return best

## structuredClone / JSON round trip: deep copy of Dictionary/Array state.
static func clone(value: Variant) -> Variant:
	if value is Dictionary: return (value as Dictionary).duplicate(true)
	if value is Array: return (value as Array).duplicate(true)
	return value

## Object.keys / Object.values / Object.entries
static func keys(dict: Dictionary) -> Array:
	return dict.keys()

static func values(dict: Dictionary) -> Array:
	return dict.values()

## Array.prototype.find: first element for which predicate returns true, else null.
static func find(items: Array, predicate: Callable) -> Variant:
	for item in items:
		if predicate.call(item): return item
	return null

static func find_index(items: Array, predicate: Callable) -> int:
	for index in items.size():
		if predicate.call(items[index]): return index
	return -1

static func some(items: Array, predicate: Callable) -> bool:
	for item in items:
		if predicate.call(item): return true
	return false

static func every(items: Array, predicate: Callable) -> bool:
	for item in items:
		if not predicate.call(item): return false
	return true

static func filter(items: Array, predicate: Callable) -> Array:
	var out := []
	for item in items:
		if predicate.call(item): out.append(item)
	return out

static func map(items: Array, mapper: Callable) -> Array:
	var out := []
	for item in items:
		out.append(mapper.call(item))
	return out

static func sum(items: Array) -> Variant:
	var total = 0
	for item in items: total += item
	return total

## Sum of all values in an inventory-style dictionary.
static func sum_values(dict: Dictionary) -> Variant:
	var total = 0
	for value in dict.values(): total += value
	return total

## Array.prototype.includes / String.prototype.includes
static func includes(collection, item) -> bool:
	if collection is String: return (collection as String).contains(str(item))
	return (collection as Array).has(item)

## String.prototype.padStart(width, "0")
static func pad_start(text: String, width: int, fill := "0") -> String:
	while text.length() < width: text = fill + text
	return text

## Number.prototype.toFixed
static func to_fixed(value: float, digits: int) -> String:
	return ("%." + str(digits) + "f") % value

## Date.now() in milliseconds.
static func now_ms() -> int:
	return int(Time.get_unix_time_from_system() * 1000.0)

## new Date().toISOString()
static func iso_now() -> String:
	var unix := Time.get_unix_time_from_system()
	var dict := Time.get_datetime_dict_from_unix_time(int(unix))
	var ms := int((unix - floor(unix)) * 1000.0)
	return "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ" % [dict.year, dict.month, dict.day, dict.hour, dict.minute, dict.second, ms]

## Reads a key that may be missing or null (TS optional chaining with ?? default).
static func get_or(dict: Dictionary, key: String, default_value: Variant) -> Variant:
	var value = dict.get(key)
	return default_value if value == null else value

## Merges `patch` into a shallow copy of `base` ({ ...base, ...patch }).
static func spread(base: Dictionary, patch: Dictionary) -> Dictionary:
	var out := base.duplicate()
	for key in patch: out[key] = patch[key]
	return out

## Clamp helper accepting ints or floats without changing type.
static func clamp_num(value, low, high):
	return low if value < low else (high if value > high else value)

## JS `%` keeps the sign of the dividend, like GDScript's fmod/%; helper for clarity.
static func mod(a: float, b: float) -> float:
	return fmod(a, b)

## Array.prototype.slice(start, end)
static func slice(items: Array, start: int, end: int = 2147483647) -> Array:
	var count := items.size()
	if start < 0: start = maxi(0, count + start)
	if end < 0: end = maxi(0, count + end)
	end = mini(end, count)
	if start >= end: return []
	return items.slice(start, end)

## Sorts a copy of items by a numeric key (stable, ascending).
static func sort_by(items: Array, key: Callable) -> Array:
	var out := items.duplicate()
	out.sort_custom(func(a, b): return key.call(a) < key.call(b))
	return out

## Number.EPSILON
const EPSILON = 2.220446049250313e-16

## Math.sign for numbers: -1, 0 or 1.
static func sign_of(value: float) -> int:
	return 1 if value > 0.0 else (-1 if value < 0.0 else 0)

## Array.prototype.sort(comparator) on a copy: JS sorts are stable, GDScript's
## sort_custom is not, so this is an insertion sort keyed by a numeric comparator
## (negative → a before b).
static func stable_sort(items: Array, comparator: Callable) -> Array:
	var out := items.duplicate()
	for i in range(1, out.size()):
		var value = out[i]
		var j := i - 1
		while j >= 0 and comparator.call(out[j], value) > 0:
			out[j + 1] = out[j]
			j -= 1
		out[j + 1] = value
	return out

## Generates an id similar to the web engine's `${prefix}-${sequence}` helpers.
static func uuid() -> String:
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	return "%08x-%04x-%04x-%04x-%012x" % [rng.randi(), rng.randi() & 0xffff, (rng.randi() & 0x0fff) | 0x4000, (rng.randi() & 0x3fff) | 0x8000, (int(rng.randi()) << 16) | (rng.randi() & 0xffff)]

## Number.isSafeInteger: an int, or a finite float with an integral value, within ±2^53.
static func is_safe_integer(value: Variant) -> bool:
	if value is int: return absi(value) <= 9007199254740991
	if value is float: return is_finite(value) and floorf(value) == value and absf(value) <= 9007199254740991.0
	return false

## Number.isFinite for a Variant (ints are always finite; non-numbers are not).
static func is_finite_number(value: Variant) -> bool:
	if value is int: return true
	if value is float: return is_finite(value)
	return false

## Number.isInteger
static func is_integer(value: Variant) -> bool:
	if value is int: return true
	if value is float: return is_finite(value) and floorf(value) == value
	return false

## JS numbers have no int/float split: a float holding an integral value is
## stored as int so JSON output matches the web engine (3200, not 3200.0).
static func number(value: Variant) -> Variant:
	if value is float and is_finite(value) and floorf(value) == value and absf(value) <= 9007199254740991.0: return int(value)
	return value

## Recursively turns integral floats into ints (what JSON.parse leaves behind).
static func restore_ints(value: Variant) -> Variant:
	if value is Dictionary:
		var out := {}
		for key in value: out[key] = restore_ints(value[key])
		return out
	if value is Array:
		var out := []
		for item in value: out.append(restore_ints(item))
		return out
	return number(value)

## JSON.parse(JSON.stringify(value)) with JS number semantics preserved.
static func json_clone(value: Variant) -> Variant:
	return restore_ints(JSON.parse_string(JSON.stringify(value)))

## [...new Set(items)]: unique values in first-seen order.
static func unique(items: Array) -> Array:
	var out := []
	for item in items:
		if not out.has(item): out.append(item)
	return out

## Array.prototype.at(index) with negative indexes; null when out of range.
static func at(items: Array, index: int) -> Variant:
	if index < 0: index += items.size()
	if index < 0 or index >= items.size(): return null
	return items[index]

## Array.prototype.flatMap
static func flat_map(items: Array, mapper: Callable) -> Array:
	var out := []
	for item in items:
		var mapped = mapper.call(item)
		if mapped is Array: out.append_array(mapped)
		else: out.append(mapped)
	return out

## Counts items for which the predicate holds (filter(...).length).
static func count(items: Array, predicate: Callable) -> int:
	var total := 0
	for item in items:
		if predicate.call(item): total += 1
	return total

## Object.fromEntries: [[key, value], ...] → Dictionary
static func from_entries(entries: Array) -> Dictionary:
	var out := {}
	for entry in entries: out[entry[0]] = entry[1]
	return out

## Object.entries: Dictionary → [[key, value], ...]
static func entries(dict: Dictionary) -> Array:
	var out := []
	for key in dict: out.append([key, dict[key]])
	return out

## Linear congruential generator shared by the shopper generators:
## `value = (Math.imul(value, 1664525) + 1013904223) >>> 0`. Returns the
## new 32-bit state; divide by 4294967296.0 for the [0, 1) sample.
static func lcg_next(value: int) -> int:
	return ((value & 0xFFFFFFFF) * 1664525 + 1013904223) & 0xFFFFFFFF

## `seed >>> 0`
static func to_uint32(value: int) -> int:
	return value & 0xFFFFFFFF

## Number(value): numeric coercion; NAN when the value is not numeric.
static func to_number(value: Variant) -> float:
	if value == null: return 0.0
	if value is bool: return 1.0 if value else 0.0
	if value is int or value is float: return float(value)
	if value is String:
		var text := (value as String).strip_edges()
		if text == "": return 0.0
		if text.is_valid_float() or text.is_valid_int(): return float(text)
		return NAN
	return NAN


## new URLSearchParams(search): keys → first value ("" when absent), like `.has()/.get()`.
static func url_search_params(search: String) -> Dictionary:
	var params := {}
	var query := search
	if query.begins_with("?"): query = query.substr(1)
	if query == "": return params
	for pair in query.split("&"):
		if pair == "": continue
		var eq := pair.find("=")
		var key := (pair if eq < 0 else pair.substr(0, eq)).uri_decode()
		var value := ("" if eq < 0 else pair.substr(eq + 1)).uri_decode()
		if not params.has(key): params[key] = value
	return params

## Array.prototype.join(separator) over any values (String(value) each).
static func join(items: Array, separator: String) -> String:
	var parts := PackedStringArray()
	for item in items: parts.append(str(item))
	return separator.join(parts)

## String.prototype.lastIndexOf
static func last_index_of(text: String, needle: String) -> int:
	return text.rfind(needle)
