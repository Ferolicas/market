extends TestCase
const Money = preload("res://game/core/money_format.gd")
func test_intl_currency_formats_in_every_supported_country() -> void:
	for scenario in JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/money-format-oracles.json")):
		assert_eq(Money.format_money(scenario.amount, scenario.state), scenario.expected, "%s %s %s" % [scenario.state.countryCode, scenario.state.currency, scenario.amount])
