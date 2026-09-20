extends TestCase
const Authority = preload("res://game/persistence/save_authority.gd")
const Events = preload("res://game/persistence/domain_events.gd")

func test_original_save_authority_scenarios_and_counterfeit_transfers() -> void:
	var oracle: Dictionary = JS.restore_ints(JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/save-oracles.json")))
	assert_gt(oracle.cases.size(), 20)
	for scenario in oracle.cases:
		var current: Dictionary = scenario.current.duplicate(true)
		var next: Dictionary = scenario.next.duplicate(true)
		assert_eq(Authority.validate_save_transition(current, next, scenario.events, scenario.options), scenario.expected, scenario.name)
		assert_eq(current, scenario.current, scenario.name + " current unchanged")
		assert_eq(next, scenario.next, scenario.name + " next unchanged")

func test_event_schema_matches_original_zod_validation() -> void:
	var oracle: Dictionary = JS.restore_ints(JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/save-oracles.json")))
	for scenario in oracle.validations:
		assert_eq(Events.validate_pending_events(scenario.events), scenario.expected)
