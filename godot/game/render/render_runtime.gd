class_name MarketRenderRuntime
extends Node
## Applies the source render profile to the actual native viewport. UI retains
## its full resolution while only the 3D buffer follows the adaptive DPR.
var world: MarketWorld
var profile := {}
var capabilities := {}
var quality := AdaptiveQuality.INITIAL_ADAPTIVE_QUALITY_STATE.duplicate()
var dpr := 1.0
var settled_ms := 0.0
var stable_frames := 0
var previous_objects := 0
var warmup_ms := 0.0
var scene_settled := false
var phase := "observing"
var previous_fps := 0

func _ready() -> void:
	previous_fps = Engine.max_fps
	get_viewport().size_changed.connect(refresh_profile)
	refresh_profile()

func refresh_profile() -> void:
	capabilities = AdaptiveQuality.current_render_capabilities()
	profile = AdaptiveQuality.market_render_profile_for_capabilities(capabilities)
	dpr = profile.dpr
	quality = AdaptiveQuality.INITIAL_ADAPTIVE_QUALITY_STATE.duplicate()
	world.lighting.set_glass_transmission(profile.glassTransmission)
	world.checkout.dynamic_ceiling_lights = not profile.mobile
	world.checkout.update(EngineProgression.current_franchise(world.store.game))
	get_viewport().msaa_3d = Viewport.MSAA_4X if profile.antialias else Viewport.MSAA_DISABLED
	RenderingServer.directional_shadow_atlas_set_size(profile.shadowMapSize, true)
	_apply_resolution()

func _apply_resolution() -> void:
	var display_density := float(get_window().size.x) / maxf(1, capabilities.width)
	get_viewport().scaling_3d_scale = clampf(dpr / display_density, 0.25, 2.0)

func _process(delta: float) -> void:
	var moving := world.motion_velocity.length() > 0.05
	var actor_moving := false
	for actor in world.actors.values():
		if actor.speed > 0.05: actor_moving = true; break
	Engine.max_fps = profile.motionFps if moving or actor_moving else profile.targetFps
	advance_frame(delta * 1000, moving, int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)))

func advance_frame(frame_ms: float, moving: bool, objects: int) -> void:
	if not scene_settled:
		warmup_ms += frame_ms
		if warmup_ms >= 10000:
			scene_settled = true
			return
		if objects != previous_objects:
			previous_objects = objects
			stable_frames = 0
			phase = "observing"
			return
		if phase == "observing":
			stable_frames += 1
			if warmup_ms >= 1200 and stable_frames >= 8:
				# Native shaders have been compiled by the actual draws during
				# observation; require the same 30 stable presentation frames.
				phase = "compiled"
				stable_frames = 0
		else:
			stable_frames = stable_frames + 1 if frame_ms <= 50 else 0
			scene_settled = stable_frames >= 30
		return
	if settled_ms < AdaptiveQuality.ADAPTIVE_QUALITY_GRACE_MS:
		settled_ms += frame_ms
		return
	var result := AdaptiveQuality.advance_adaptive_quality(quality, frame_ms, AdaptiveQuality.MOBILE_MOTION_ADAPTIVE_QUALITY if moving else AdaptiveQuality.MOBILE_ADAPTIVE_QUALITY)
	quality = result.state
	var next_dpr: float = AdaptiveQuality.regressed_dpr(dpr, profile) if result.regress else (AdaptiveQuality.recovered_dpr(dpr, profile) if result.recover else dpr)
	if absf(next_dpr - dpr) > 0.001:
		dpr = next_dpr
		_apply_resolution()

func _exit_tree() -> void:
	Engine.max_fps = previous_fps
