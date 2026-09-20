class_name MoneyFormat
extends RefCounted
static var _rules: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://game/core/money-format.json"))

static func format_money(amount_minor: float, state: Dictionary) -> String:
	var rule: Dictionary = _rules[state.countryCode + ":" + state.currency]
	# Intl rounds the absolute value, then applies the locale's sign pattern.
	var major := absf(amount_minor) / 100.0
	var numeric := str(JS.round(major))
	if rule.digits > 0:
		# Intl converts the double to its shortest decimal representation first.
		# At the safe-integer limit, multiplying back by 100 loses cents.
		for precision in range(rule.digits + 1):
			var candidate: String = ("%." + str(precision) + "f") % major
			if candidate.to_float() == major or precision == rule.digits:
				numeric = candidate
				break
	var pieces := numeric.split(".")
	var integer: String = pieces[0]
	var fraction: String = pieces[1] if pieces.size() > 1 else ""
	while fraction.length() < rule.digits: fraction += "0"
	if integer.length() >= (4 if rule.groupFour else 5):
		var grouped := ""
		for index in integer.length():
			if index > 0 and (integer.length() - index) % 3 == 0: grouped += rule.group
			grouped += integer[index]
		integer = grouped
	var number: String = integer + (rule.decimal + fraction if rule.digits else "")
	return (rule.negative if amount_minor < 0 else rule.positive).replace("{number}", number)
