extends TestCase
## Port of src/game/progression/PurchaseTiming.test.ts (engine-free case).
## "completes the first purchase after twenty pulses" lives in test_purchase_timing_engine.gd.

func test_pays_a_quarter_of_any_price_per_second_so_every_marker_fills_in_four_seconds() -> void:
	for cost in [2000, 12345, 1800000]:
		var pulse := PurchaseState.purchase_contribution_pulse_minor(cost)
		var pulses := JS.ceil(float(cost) / pulse)
		assert_lte(pulses * PurchaseState.PURCHASE_CONTRIBUTION_PULSE_MS, PurchaseState.PURCHASE_CONTRIBUTION_FILL_MS)
		assert_gte(pulse * (1000 / PurchaseState.PURCHASE_CONTRIBUTION_PULSE_MS), cost / 4.0)
	assert_eq(PurchaseState.purchase_contribution_pulse_minor(0), 0)
