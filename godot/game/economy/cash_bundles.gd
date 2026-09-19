class_name CashBundles
extends RefCounted
## Port of src/game/economy/cash-bundles.ts.

## Physical money in the world: one bundle per ten euros of base money,
## scaled by the country. 200 € in a drawer is twenty bundles stacked.
const CASH_BUNDLE_BASE_MINOR := 1000
## Bundles drawn per drawer before the stack stops growing (performance).
const CASH_BUNDLE_RENDER_CAP := 240

static func cash_bundle_minor(money_scale: Variant) -> int:
	var scale: float = float(money_scale) if JS.is_finite_number(money_scale) and money_scale > 0 else 1.0
	return maxi(1, JS.round(CASH_BUNDLE_BASE_MINOR * scale))

## Whole bundles in an amount; any money at all shows at least one.
static func cash_bundle_count(amount_minor: Variant, bundle_minor: Variant) -> int:
	if not JS.is_finite_number(amount_minor) or amount_minor <= 0: return 0
	return maxi(1, JS.floor(float(amount_minor) / maxf(1.0, float(bundle_minor))))
