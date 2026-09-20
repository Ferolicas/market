extends TestCase
const Factory = preload("res://game/core/game_factory.gd")

func test_every_initial_and_campaign_field_matches_typescript_in_all_countries() -> void:
	var oracle: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/source-oracles.json"))
	for country in oracle.initial:
		assert_eq(Factory.create_initial_game(country), oracle.initial[country], country + " initial")
		assert_eq(Factory.create_campaign_game(country), oracle.campaign[country], country + " campaign")
		for role in oracle.hiring[country]: assert_eq(Factory.employee_hiring_quote(role, country), oracle.hiring[country][role], country + " " + role)

func test_all_obstacles_match_original_composition() -> void:
	var oracle: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/source-oracles.json"))
	assert_eq(WorldScale.STORE_OBSTACLES, oracle.obstacles)

func test_separate_games_and_franchises_do_not_share_mutable_inventory() -> void:
	var first := Factory.create_campaign_game()
	var second := Factory.create_campaign_game()
	first.franchises[0].warehouse.tomatoes = 99
	first.avatar.hat = "frog"
	assert_eq(first.franchises[1].warehouse.tomatoes, 0)
	assert_eq(second.franchises[0].warehouse.tomatoes, 0)
	assert_eq(second.avatar.hat, "none")
