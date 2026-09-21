extends TestCase
const Warmup = preload("res://game/render/cast_warmup.gd")
const CharacterPresentation = preload("res://game/animation/character_presentation.gd")
var scope: Node3D
var lighting: SourcePbr
var warmup: Warmup

func before_each() -> void:
	# The application always parents MarketCastWarmup under MarketWorld,
	# which binds SourcePbr first; replicate that so materials get the same
	# lifecycle they have in production.
	scope = Node3D.new()
	Engine.get_main_loop().root.add_child(scope)
	lighting = SourcePbr.new()
	lighting.scope = scope
	scope.add_child(lighting)
	warmup = Warmup.new()
	scope.add_child(warmup)

func after_each() -> void:
	if warmup != null: warmup.queue_free()
	scope.queue_free()
	await Engine.get_main_loop().process_frame

## The six models used to load in a single blocking frame, freezing the
## loading curtain's animation; prepare() must now add one body per frame so
## the curtain stays fluid while the cast warms up.
func test_adds_one_body_per_frame_instead_of_freezing_a_single_frame() -> void:
	var tier := CharacterPresentation.character_model_tier_for_capabilities(CharacterPresentation.current_character_capabilities())
	var expected: int = CharacterPresentation.priority_customer_model_paths_for_tier(tier).size()
	assert_gt(expected, 1)
	warmup.prepare(Vector3.ZERO)
	# GDScript runs a coroutine synchronously up to its first await, so the
	# first body lands immediately; the rest trickle in one per frame.
	assert_eq(warmup.get_child_count(), 1)
	for step in expected - 1:
		await Engine.get_main_loop().process_frame
		assert_eq(warmup.get_child_count(), step + 2)
	assert_eq(warmup.get_child_count(), expected)

func test_stops_cleanly_if_freed_mid_warmup() -> void:
	warmup.prepare(Vector3.ZERO)
	await Engine.get_main_loop().process_frame
	assert_gt(warmup.get_child_count(), 0)
	warmup.queue_free()
	await Engine.get_main_loop().process_frame
	await Engine.get_main_loop().process_frame
	warmup = null # already freed; skip after_each's redundant free()
