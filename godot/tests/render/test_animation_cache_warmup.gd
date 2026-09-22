extends TestCase
const Warmup = preload("res://game/render/animation_cache_warmup.gd")
const Actor = preload("res://game/scene/market_actor.gd")

## Real device data: sync_state()'s first call paid ~90ms per never-before-seen
## identity (6 customers + 2 employee genders x hat/bald) because
## compose_carry_animation_library()'s cache started cold, and only ~16-17ms
## for an already-cached identity. Warming it here, before World.new() ever
## runs, means that first sync_state() call should hit the cache instead of
## paying for it — proven by spawning a real actor for every warmed identity
## afterwards and confirming the compose step no longer dominates (the
## remaining instantiate/material/skeleton-scan cost is real and unaffected
## by this warmup, so the bar here is "well under the unwarmed ~90-120ms
## total", not "as fast as a fully warm repeat spawn").
func test_warms_every_identity_sync_state_is_about_to_spawn() -> void:
	await Warmup.warm(Engine.get_main_loop())
	for identity in range(1, 7):
		var actor := Actor.new()
		Engine.get_main_loop().root.add_child(actor)
		var start := Time.get_ticks_msec()
		actor.configure_customer(identity)
		var elapsed := Time.get_ticks_msec() - start
		assert_lt(elapsed, 60, "customer identity %d should already be warm" % identity)
		actor.free()
	for body in ["adult-man", "adult-woman"]:
		for hat in ["none", "owl"]:
			var actor := Actor.new()
			Engine.get_main_loop().root.add_child(actor)
			var start := Time.get_ticks_msec()
			actor.configure_avatar({"body": body, "hair": "fade", "skin": "#a96f50", "shirt": "#e7a959", "hairColor": "#3b2820", "hat": hat})
			var elapsed := Time.get_ticks_msec() - start
			assert_lt(elapsed, 60, "%s/hat=%s should already be warm" % [body, hat])
			actor.free()
