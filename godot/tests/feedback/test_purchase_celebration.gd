extends TestCase

func test_celebrates_only_a_new_purchase_in_the_same_store_never_loading_or_travelling() -> void:
	var before := { "franchiseId": "barrio", "purchased": ["farmer-1"] }
	var after := JS.spread(before, { "purchased": ["farmer-1", "cow-1"] })
	assert_null(PurchaseCelebration.newly_completed_purchase(null, after))
	assert_null(PurchaseCelebration.newly_completed_purchase(before, JS.spread(after, { "franchiseId": "megastore" })))
	assert_eq(PurchaseCelebration.newly_completed_purchase(before, after), "cow-1")
	assert_null(PurchaseCelebration.newly_completed_purchase(after, after))
