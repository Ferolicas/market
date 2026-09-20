class_name MarketSafeArea
extends RefCounted
## CSS env() remains the platform authority in installed browser/PWA windows.
## Components receive logical viewport units, including high-density displays.
static var _read_at := -1000
static var _insets := Vector4.ZERO
static var _window_size := Vector2.ZERO

static func insets(viewport: Viewport) -> Vector4:
	if not OS.has_feature("web"): return Vector4.ZERO
	var size := viewport.get_visible_rect().size
	if Time.get_ticks_msec() - _read_at < 500 and size == _window_size: return _insets
	_read_at = Time.get_ticks_msec()
	_window_size = size
	var raw: Variant = JavaScriptBridge.eval("""(() => {
		let probe = document.getElementById('market-safe-area');
		if(!probe) {
			probe = document.createElement('div'); probe.id='market-safe-area';
			probe.style.cssText='position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
			document.body.append(probe);
		}
		const css=getComputedStyle(probe);
		return JSON.stringify([parseFloat(css.paddingLeft)||0,parseFloat(css.paddingTop)||0,parseFloat(css.paddingRight)||0,parseFloat(css.paddingBottom)||0,innerWidth,innerHeight]);
	})()""", true)
	var data: Array = JSON.parse_string(str(raw))
	var scale := size / Vector2(maxf(1, data[4]), maxf(1, data[5]))
	_insets = Vector4(data[0]*scale.x, data[1]*scale.y, data[2]*scale.x, data[3]*scale.y)
	return _insets
