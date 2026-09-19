extends TestCase
## Port of src/game/economy/cash-bundles.test.ts

func test_shows_one_bundle_per_ten_euros_200_is_twenty_bundles() -> void:
	assert_eq(CashBundles.cash_bundle_minor(1), CashBundles.CASH_BUNDLE_BASE_MINOR)
	assert_eq(CashBundles.cash_bundle_count(20000, CashBundles.cash_bundle_minor(1)), 20)
	assert_eq(CashBundles.cash_bundle_count(1999, CashBundles.cash_bundle_minor(1)), 1)
	assert_eq(CashBundles.cash_bundle_count(371, CashBundles.cash_bundle_minor(1)), 1)
	assert_eq(CashBundles.cash_bundle_count(0, CashBundles.cash_bundle_minor(1)), 0)

func test_scales_the_bundle_with_the_countrys_money() -> void:
	assert_eq(CashBundles.cash_bundle_minor(4), 4000)
	assert_eq(CashBundles.cash_bundle_count(80000, CashBundles.cash_bundle_minor(4)), 20)
	assert_eq(CashBundles.cash_bundle_minor(NAN), CashBundles.CASH_BUNDLE_BASE_MINOR)
