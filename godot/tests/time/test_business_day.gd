extends TestCase
## Port of src/game/time/BusinessDay.test.ts

func test_maps_exactly_three_active_real_hours_from_opening_to_21_00() -> void:
	assert_eq(BusinessDay.BUSINESS_DAY_OPEN_MINUTE + BusinessDay.business_minutes_for_real_ms(BusinessDay.BUSINESS_DAY_REAL_DURATION_MS), BusinessDay.BUSINESS_DAY_NIGHT_MINUTE)
	assert_eq(BusinessDay.business_minutes_for_real_ms(BusinessDay.BUSINESS_DAY_REAL_DURATION_MS / 2), BusinessDay.BUSINESS_DAY_GAME_MINUTES / 2.0)
	assert_false(BusinessDay.business_day_is_closing(BusinessDay.BUSINESS_DAY_NIGHT_MINUTE - 0.01))
	assert_true(BusinessDay.business_day_is_closing(BusinessDay.BUSINESS_DAY_NIGHT_MINUTE))

func test_stays_fully_daylight_until_18_00_and_reaches_night_at_21_00() -> void:
	var opening := BusinessDay.daylight_presentation(BusinessDay.BUSINESS_DAY_OPEN_MINUTE)
	var dusk := BusinessDay.daylight_presentation(BusinessDay.BUSINESS_DAY_DUSK_MINUTE)
	var sunset := BusinessDay.daylight_presentation((BusinessDay.BUSINESS_DAY_DUSK_MINUTE + BusinessDay.BUSINESS_DAY_NIGHT_MINUTE) / 2.0)
	var night := BusinessDay.daylight_presentation(BusinessDay.BUSINESS_DAY_NIGHT_MINUTE)

	assert_eq(opening, dusk)
	assert_eq(opening["phase"], "day")
	assert_eq(sunset["phase"], "sunset")
	assert_eq(night["phase"], "night")
	assert_lt(night["ambientIntensity"], sunset["ambientIntensity"])
	assert_lt(sunset["ambientIntensity"], opening["ambientIntensity"])
	assert_eq(sunset["background"], sunset["fog"])
	assert_eq(sunset["background"].length(), 7)
