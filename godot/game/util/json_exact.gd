class_name JsonExact
extends RefCounted
## Godot's JSON number parser can round 9007199254740991 up by one.
## Tokenize numbers without touching quoted strings, parse the structure with
## the engine, then restore numeric tokens using correctly rounded conversion.
static var _number_syntax := RegEx.create_from_string("^-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?$")

static func parse(text: String) -> Variant:
	var marker := "__market_number__"
	while marker in text: marker += "_"
	var numbers: Array = []
	var segments: PackedStringArray = []
	var index := 0
	var start := 0
	while index < text.length():
		var character := text[index]
		if character == '"':
			index += 1
			while index < text.length():
				if text[index] == "\\": index += 2
				elif text[index] == '"':
					index += 1
					break
				else: index += 1
		elif character == "-" or (character >= "0" and character <= "9"):
			segments.append(text.substr(start, index - start))
			var number_start := index
			while index < text.length() and text[index] in "0123456789.eE+-": index += 1
			var token := text.substr(number_start, index - number_start)
			# Let the engine reject malformed numbers rather than accepting a
			# partial String.to_float() conversion from an invalid save.
			if _number_syntax.search(token) == null: return null
			var value: Variant = token.to_float()
			if token.is_valid_int() and token.trim_prefix("-").length() <= 16:
				var integer := token.to_int()
				if absi(integer) <= 9007199254740991: value = integer
			segments.append(JSON.stringify(marker + str(numbers.size())))
			numbers.append(value)
			start = index
		else: index += 1
	segments.append(text.substr(start))
	var parser := JSON.new()
	if parser.parse("".join(segments)) != OK: return null
	return _restore(parser.data, marker, numbers)

static func _restore(value: Variant, marker: String, numbers: Array) -> Variant:
	if value is String and value.begins_with(marker): return numbers[value.substr(marker.length()).to_int()]
	if value is Array:
		for index in value.size(): value[index] = _restore(value[index], marker, numbers)
	elif value is Dictionary:
		for key in value: value[key] = _restore(value[key], marker, numbers)
	return value
