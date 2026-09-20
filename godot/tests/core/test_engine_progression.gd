extends TestCase
const Progression = preload("res://game/core/engine_progression.gd")
const Factory = preload("res://game/core/game_factory.gd")

func _oracle() -> Dictionary:
	return JSON.parse_string(FileAccess.get_file_as_bytes("res://tests/fixtures/progression-oracles.json.gz").decompress_dynamic(128 * 1024 * 1024, FileAccess.COMPRESSION_GZIP).get_string_from_utf8())

func test_all_legacy_unlocks_match_original_in_seven_countries() -> void:
	var states := {}
	for scenario in _oracle().legacy:
		if scenario.country not in states:
			states[scenario.country] = Factory.create_initial_game(scenario.country)
			states[scenario.country].simulationTimeMs = 12345
		var state: Dictionary = states[scenario.country]
		state.level = scenario.level
		Progression.apply_level_unlock(state, state.franchises[0], scenario.level)
		assert_eq(state, scenario.state, "%s level %d" % [scenario.country, scenario.level])

func test_every_campaign_purchase_and_staff_grant_matches_original() -> void:
	var states := {}
	for scenario in _oracle().campaign:
		if scenario.country not in states:
			states[scenario.country] = Factory.create_campaign_game(scenario.country)
			states[scenario.country].simulationTimeMs = 12345
		var state: Dictionary = states[scenario.country]
		state.franchises[0].purchases.purchased.append(scenario.id)
		Progression.apply_purchase_content(state, state.franchises[0], scenario.id)
		Progression.normalize_level(state)
		assert_eq(state, scenario.state, "%s purchase %s" % [scenario.country, scenario.id])
		var stable := state.duplicate(true)
		Progression.normalize_level(state)
		assert_eq(state, stable, "staff grants are idempotent")

func test_retired_purchases_staff_and_missing_coffee_bed_match_original() -> void:
	for scenario in _oracle().sanitize:
		var state: Dictionary = scenario.before.duplicate(true)
		Progression.sanitize_campaign_purchases(state.franchises[0])
		Progression.trim_campaign_staff(state.franchises[0])
		Progression.sync_campaign_crops(state, state.franchises[0])
		Progression.sync_campaign_staff(state, state.franchises[0])
		Progression.sync_campaign_progression(state)
		assert_eq(state, scenario.after)

func test_build_funding_is_preserved_when_country_prices_are_normalized() -> void:
	for scenario in _oracle().builds:
		assert_eq(Progression.normalize_build_project(scenario.project, scenario.country), scenario.result)

func test_upgrade_selection_quotes_and_effects_match_original() -> void:
	for scenario in _oracle().upgrades:
		var state: Dictionary = scenario.state.duplicate(true)
		var target = Progression.upgrade_target(state, state.franchises[0], scenario.upgrade)
		assert_eq(target, scenario.target, scenario.upgrade)
		assert_eq(Progression.upgrade_quote(state, scenario.upgrade), scenario.quote, scenario.upgrade)
		if target != null:
			Progression.apply_upgrade_target(state, state.franchises[0], target)
			if target.kind == "hire":
				var id: String = state.franchises[0].employees.back().id
				assert_eq(id.length(), 36, "hiring generates a UUID")
				state.franchises[0].employees.back().id = "<generated-uuid>"
		assert_eq(state, scenario.after, "%s %s" % [state.countryCode, scenario.upgrade])

func test_roster_upgrades_match_original_for_every_actor_and_country() -> void:
	for scenario in _oracle().roster:
		var franchise: Dictionary = scenario.before.duplicate(true)
		Progression.apply_roster_upgrade(franchise, scenario.entry)
		assert_eq(franchise, scenario.after, scenario.entry.id)

func test_player_progress_attributes_only_positive_non_player_deltas() -> void:
	for scenario in _oracle().attribution:
		var state: Dictionary = scenario.state.duplicate(true)
		Progression.attribute_player_action(state, scenario.action, scenario.before)
		assert_eq(state, scenario.after)

func test_register_normalization_preserves_money_and_adds_missing_drawer() -> void:
	assert_eq(Progression.normalize_register_cash([93, 47]), [93, 47, 0])
	assert_eq(Progression.normalize_register_cash([93, null, 8]), [93, 0, 8])
	assert_eq(Progression.normalize_register_cash(null), [0, 0, 0])
