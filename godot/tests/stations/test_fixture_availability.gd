extends TestCase
## Port of src/game/stations/fixture-availability.test.ts (fixtureAvailable part).
## The obstacle/navigation assertions live in test_fixture_availability_layout.gd.

const OPENING := ["purchase-campaign"]
const CASES := [
	["fixture:corn-canner", "corn-canner"],
	["fixture:retail-preserves-1", "preserves-supply"],
	["fixture:retail-eggs-1", "egg-display"],
	["fixture:retail-produce-2", "expansion-side"],
	["fixture:retail-dairy-1", "dairy-display"],
	["fixture:retail-pantry-1", "coffee-supply"],
	["fixture:retail-bakery-1", "farm-wheat"],
	["fixture:retail-drinks-1", "juice-machine"],
	["fixture:flour-mill", "flour-mill"],
	["fixture:bread-oven", "bread-oven"],
	["fixture:cheese-maker", "cheese-maker"],
	["fixture:juice-machine", "juice-machine"],
	["fixture:checkout-2", "checkout-2"],
	["fixture:checkout-3", "checkout-3"],
	["fixture:chicken-coop", "chicken-coop"],
	["fixture:chicken-coop-2", "chicken-coop-2"],
	["fixture:cow-station", "cow-station"],
]

func test_opens_and_closes_each_fixture_with_its_area() -> void:
	for case in CASES:
		assert_false(FixtureAvailability.fixture_available(case[0], OPENING), case[0])
		assert_true(FixtureAvailability.fixture_available(case[0], OPENING + [case[1]]), case[0])

func test_keeps_legacy_fixtures_and_leaves_the_unopened_egg_department_walkable() -> void:
	for case in CASES:
		var legacy_available := not ["fixture:retail-preserves-1", "fixture:corn-canner"].has(case[0])
		assert_eq(FixtureAvailability.fixture_available(case[0]), legacy_available, case[0])
	assert_true(FixtureAvailability.fixture_available(null, OPENING))
	assert_true(FixtureAvailability.fixture_available("fixture:retail-produce-1", OPENING))
	assert_eq(FixtureAvailability.ALL_PURCHASED_AREAS.size(), 17)
	for case in CASES: assert_true(FixtureAvailability.fixture_available(case[0], FixtureAvailability.ALL_PURCHASED_AREAS), case[0])
