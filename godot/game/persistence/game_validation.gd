class_name GameValidation
extends RefCounted
## Source-derived savePayloadSchema. Object parsing strips unknown properties;
## inventory records reject unknown product IDs and require all authored keys.
static var _schema: Dictionary = preload("res://game/util/json_exact.gd").parse(FileAccess.get_file_as_string("res://game/persistence/save-schema.json"))
static var _patterns: Dictionary = {}

static func safe_parse_save_payload(input: Variant) -> Dictionary:
	var result := _parse(_schema, input, "$", true)
	if not result.success: return result
	for franchise in result.data.state.franchises:
		if franchise.registerCashMinor.size() == 2: franchise.registerCashMinor.append(0)
	return result

static func parse_save_payload(input: Variant) -> Dictionary:
	var result := safe_parse_save_payload(input)
	if not result.success:
		push_error("Invalid save payload: %s" % result.error)
		return {}
	return result.data

static func _error(path: String, reason: String) -> Dictionary:
	return {"success": false, "error": {"path": path, "message": reason}}

static func _parse(schema: Dictionary, value: Variant, path: String, present: bool) -> Dictionary:
	if not present:
		if "default" in schema: return {"success": true, "data": JS.clone(schema.default)}
		return _error(path, "Required")
	if "anyOf" in schema:
		for option in schema.anyOf:
			var candidate := _parse(option, value, path, true)
			if candidate.success: return candidate
		return _error(path, "Invalid union")
	if "const" in schema and not _same_literal(value, schema.const): return _error(path, "Invalid literal")
	if "enum" in schema and not schema.enum.any(func(candidate): return _same_literal(value, candidate)): return _error(path, "Invalid enum value")
	var kind: String = schema.get("type", "")
	match kind:
		"null":
			if value != null: return _error(path, "Expected null")
		"boolean":
			if not value is bool: return _error(path, "Expected boolean")
		"number", "integer":
			if not JS.is_finite_number(value): return _error(path, "Expected finite number")
			if kind == "integer" and not JS.is_safe_integer(value): return _error(path, "Expected safe integer")
			if value < schema.get("minimum", -INF) or value > schema.get("maximum", INF): return _error(path, "Number out of range")
			if "exclusiveMinimum" in schema and value <= schema.exclusiveMinimum: return _error(path, "Number below exclusive minimum")
		"string":
			if not value is String: return _error(path, "Expected string")
			var length: int = value.to_utf16_buffer().size() / 2
			if length < schema.get("minLength", 0) or length > schema.get("maxLength", 2147483647): return _error(path, "String length out of range")
			if "pattern" in schema:
				if schema.pattern not in _patterns: _patterns[schema.pattern] = RegEx.create_from_string(schema.pattern)
				if _patterns[schema.pattern].search(value) == null: return _error(path, "Invalid string format")
		"array":
			if not value is Array: return _error(path, "Expected array")
			if value.size() < schema.get("minItems", 0) or value.size() > schema.get("maxItems", 2147483647): return _error(path, "Array size out of range")
			var parsed: Array = []
			for index in value.size():
				var item_schema: Dictionary = schema.prefixItems[index] if "prefixItems" in schema and index < schema.prefixItems.size() else schema.get("items", {})
				var item := _parse(item_schema, value[index], "%s[%d]" % [path, index], true)
				if not item.success: return item
				parsed.append(item.data)
			return {"success": true, "data": parsed}
		"object":
			if not value is Dictionary: return _error(path, "Expected object")
			for key in schema.get("required", []):
				if key not in value: return _error(path + "." + key, "Required")
			var parsed := {}
			if "properties" in schema:
				for key in schema.properties:
					if key not in value and "default" not in schema.properties[key]: continue
					var item := _parse(schema.properties[key], value.get(key), path + "." + key, key in value)
					if not item.success: return item
					parsed[key] = item.data
			else:
				for key in value:
					var name_check := _parse(schema.get("propertyNames", {}), key, path, true)
					if not name_check.success: return name_check
					var item := _parse(schema.get("additionalProperties", {}), value[key], path + "." + str(key), true)
					if not item.success: return item
					parsed[key] = item.data
			return {"success": true, "data": parsed}
	return {"success": true, "data": JS.clone(value)}

static func _same_literal(value: Variant, literal: Variant) -> bool:
	if JS.is_finite_number(value) and JS.is_finite_number(literal): return value == literal
	return typeof(value) == typeof(literal) and value == literal
