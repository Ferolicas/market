class_name AdaptiveQuality
extends RefCounted
## Port of src/game/render/AdaptiveQuality.ts.
## AdaptiveQualityState: { slowForMs, cooldownMs, healthyForMs }
## AdaptiveQualityConfig: { slowFrameMs, sustainedSlowMs, cooldownMs, recoveryRate, recoverAfterMs }
## MarketRenderCapabilities: { width, coarsePointer, devicePixelRatio? }
## MarketRenderProfile: { mobile, dpr, minDpr, targetFps, motionFps, antialias, shadowMapSize,
##   transmissionResolutionScale, glassTransmission, powerPreference, baseline? }
## In Godot `dpr` maps to Viewport.scaling_3d_scale, targetFps/motionFps to
## Engine.max_fps, shadowMapSize to the directional shadow size and
## glassTransmission to refraction on the glass material.

## One adaptive resolution step (multiplicative).
const ADAPTIVE_DPR_STEP := 0.86
## Programs for late content (customers, accessories) still compile shortly
## after the scene is declared ready; that warm-up must not count as sustained
## pressure.
const ADAPTIVE_QUALITY_GRACE_MS := 2500

const MOBILE_ADAPTIVE_QUALITY := {
	# Mobile intentionally renders at 30 FPS. A healthy 33 ms frame must not
	# be mistaken for GPU pressure and trigger another quality reduction.
	"slowFrameMs": 40,
	"sustainedSlowMs": 420,
	"cooldownMs": 1200,
	"recoveryRate": 2,
	"recoverAfterMs": 8000,
}

const MOBILE_MOTION_ADAPTIVE_QUALITY := {
	# At 60 Hz, sustained 24 ms presentation frames indicate that resolution
	# should step down before uneven cadence becomes visible.
	"slowFrameMs": 24,
	"sustainedSlowMs": 650,
	"cooldownMs": 1200,
	"recoveryRate": 2,
	"recoverAfterMs": 8000,
}

const INITIAL_ADAPTIVE_QUALITY_STATE := { "slowForMs": 0, "cooldownMs": 0, "healthyForMs": 0 }

static func _device_dpr(capabilities: Dictionary) -> float:
	var ratio = capabilities.get("devicePixelRatio")
	return float(ratio) if JS.is_finite_number(ratio) else 1.0

## Live capabilities from the Godot runtime.
static func current_render_capabilities() -> Dictionary:
	return {
		"width": DisplayServer.window_get_size().x,
		"coarsePointer": DisplayServer.is_touchscreen_available() or OS.has_feature("mobile"),
		"devicePixelRatio": DisplayServer.screen_get_scale(),
	}

## Balanced renderer policy. Mobile keeps a low-power 30 FPS idle loop and
## presents locomotion at 60 FPS. Both platforms render at (or near) the
## panel's native density: drawing fewer pixels than the screen has and
## stretching them is what reads as a pixelated character. The adaptive
## controller only steps below that after sustained, measured pressure and
## hands the resolution back once frames are healthy again.
static func market_render_profile_for_capabilities(capabilities: Dictionary) -> Dictionary:
	var mobile: bool = capabilities.coarsePointer or capabilities.width <= 820
	var device_dpr := _device_dpr(capabilities)
	if mobile:
		return {
			"mobile": true,
			# DPR 1.25 on a DPR 3 phone stretched every rendered pixel 2.4 times.
			# Two device pixels per CSS pixel keeps silhouettes and faces crisp;
			# the third one on flagship panels is not worth its fill cost here.
			"dpr": maxf(1.0, minf(2.0, device_dpr)),
			"minDpr": maxf(1.0, minf(1.5, device_dpr)),
			"targetFps": 30,
			"motionFps": 60,
			"antialias": true,
			"shadowMapSize": 512,
			"transmissionResolutionScale": 0.5,
			"glassTransmission": false,
			"powerPreference": "low-power",
		}
	return {
		"mobile": false,
		"dpr": maxf(0.85, minf(2.0, device_dpr)),
		"minDpr": 0.85,
		"targetFps": 60,
		"motionFps": 60,
		"antialias": true,
		"shadowMapSize": 1024,
		"transmissionResolutionScale": 1,
		"glassTransmission": true,
		"powerPreference": "high-performance",
	}

## Historical mobile settings retained exclusively by the gated QA build.
## This provides a same-code, same-assets baseline and is never selected by a
## public production build.
static func legacy_mobile_render_profile(capabilities: Dictionary) -> Dictionary:
	var device_dpr := _device_dpr(capabilities)
	return {
		"mobile": true,
		"dpr": maxf(0.85, minf(1.4, device_dpr)) * 0.86,
		"minDpr": 0.75,
		"targetFps": 60,
		"motionFps": 60,
		"antialias": true,
		"shadowMapSize": 1024,
		"transmissionResolutionScale": 1,
		"glassTransmission": true,
		"powerPreference": "high-performance",
		"baseline": true,
	}

## Pure sustained-frame-budget gate. `regress` asks for one resolution step
## down; `recover` reports that presentation has stayed in budget long enough
## to hand one step back. Returns { state, regress, recover }.
static func advance_adaptive_quality(previous: Dictionary, frame_ms: float, config: Dictionary = MOBILE_ADAPTIVE_QUALITY) -> Dictionary:
	var safe_frame_ms := maxf(0.0, minf(250.0, frame_ms if is_finite(frame_ms) else 0.0))
	var cooldown_ms := maxf(0.0, previous.cooldownMs - safe_frame_ms)
	var slow := safe_frame_ms >= config.slowFrameMs
	var slow_for_ms: float = previous.slowForMs + safe_frame_ms if slow else maxf(0.0, previous.slowForMs - safe_frame_ms * config.recoveryRate)
	var healthy_for_ms: float = 0.0 if slow else previous.healthyForMs + safe_frame_ms
	if cooldown_ms == 0.0 and slow_for_ms >= config.sustainedSlowMs:
		return { "state": { "slowForMs": 0, "cooldownMs": config.cooldownMs, "healthyForMs": 0 }, "regress": true, "recover": false }
	if healthy_for_ms >= config.recoverAfterMs:
		return { "state": { "slowForMs": slow_for_ms, "cooldownMs": cooldown_ms, "healthyForMs": 0 }, "regress": false, "recover": true }
	return { "state": { "slowForMs": slow_for_ms, "cooldownMs": cooldown_ms, "healthyForMs": healthy_for_ms }, "regress": false, "recover": false }

## Next render scale after one adaptive step down, never below the profile floor.
static func regressed_dpr(current_dpr: float, profile: Dictionary) -> float:
	return maxf(profile.minDpr, current_dpr * ADAPTIVE_DPR_STEP)

## Next render scale after handing one adaptive step back, never above the profile.
static func recovered_dpr(current_dpr: float, profile: Dictionary) -> float:
	return minf(profile.dpr, current_dpr / ADAPTIVE_DPR_STEP)

## Manual-loop presentation cadence. Time-based gating ("present when 16.7 ms
## have elapsed") drifts against the panel's own vsync and produces alternating
## short/long frames on 90 Hz and 120 Hz phones. Counting frame ticks against
## the measured refresh interval presents on an even sub-multiple instead:
## 60 Hz → every tick, 120 Hz → every second tick, 90 Hz → every second tick
## (45 FPS, even) rather than 60 FPS with a 22/11 ms stutter.
class DisplayCadenceEstimator extends RefCounted:
	var _deltas: Array[float] = []
	var _index := 0
	var _filled := 0
	var _last_tick_ms: Variant = null

	func _init(window_size: int = 48) -> void:
		_deltas.resize(maxi(4, window_size))
		_deltas.fill(0.0)

	## Records one frame timestamp (ms) and returns the estimated refresh
	## interval in ms. A slow main thread only ever lengthens frame deltas, so
	## the minimum over the recent window tracks the true vsync.
	func observe(tick_ms: float) -> float:
		if _last_tick_ms != null:
			var delta: float = tick_ms - _last_tick_ms
			if delta > 0.0:
				_deltas[_index] = minf(50.0, maxf(4.0, delta))
				_index = (_index + 1) % _deltas.size()
				_filled = mini(_deltas.size(), _filled + 1)
		_last_tick_ms = tick_ms
		return refresh_interval_ms()

	func refresh_interval_ms() -> float:
		if _filled == 0: return 1000.0 / 60.0
		var minimum := INF
		for i in _filled: minimum = minf(minimum, _deltas[i])
		return minimum

	func reset() -> void:
		_filled = 0
		_index = 0
		_last_tick_ms = null

## Number of frame ticks between presentations for a target rate.
static func presentation_divisor(refresh_interval_ms: float, target_fps: float) -> int:
	var refresh_hz := 1000.0 / maxf(1.0, refresh_interval_ms)
	return maxi(1, JS.round(refresh_hz / maxf(1.0, target_fps)))
