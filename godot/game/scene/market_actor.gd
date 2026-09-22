class_name MarketActor
extends Node3D
## Original cast and animation clips; economy/runtime remains in MarketStore.
const BODY_FILES = {"adult-man": "owner_man", "adult-woman": "owner_woman", "boy": "owner_boy", "girl": "owner_girl"}
const BODY_SCALE = {"adult-man": 1.264, "adult-woman": 1.302, "boy": 1.322, "girl": 1.264}
const HAT_FIT = {"adult-man": 0.49, "adult-woman": 0.49, "boy": 0.64, "girl": 0.68}
const CUSTOMER_FILES = ["customer_01_man_young", "customer_02_man_senior", "customer_03_woman_young", "customer_04_woman_adult", "customer_05_woman_mature", "customer_06_woman_senior"]
const CUSTOMER_SCALE = [1.236, 1.226, 1.291, 1.265, 1.265, 1.216]
const PICKUP_HEIGHT = {"tomatoes": 0.86, "apples": 0.86, "oranges": 0.86, "corn": 0.92, "eggs": 0.92, "milk": 1.02, "cheese": 1.02, "juice": 1.02, "bread": 0.9, "flour": 0.9, "wheat": 0.9, "coffee": 0.9, "cannedCorn": 0.9}
var pickup_visual: Node3D
var pickup_product := ""
var stable_head: Variant = null
var shopping_bag: AuthoredScene
var cart: CustomerCartPresentation
var checkout_transaction: Variant
var checkout_unit_key := ""
var checkout_loading: Variant
var employee_role := ""
var employee_state := ""
var identity := 0
var model_tier := 0
var facial: FacialController
var face_meshes: Array = []
var facial_elapsed := 0.0
var last_facial_update := -1.0
var external_time := -1.0
var customer_runtime: Dictionary = {}
var grounding := FootGroundingController.new()
var feedback_source := ""
var feedback_actor_id := ""
var avatar_body := "adult-man"
var skeleton: Skeleton3D
var carry_frame: Node3D
var basket: HarvestBasketPresentation
var model: Node3D
var player: AnimationPlayer
var locomotion := LocomotionController.new()
var actions: Dictionary = {}
var clips: Dictionary = {}
var appearance := ""
var render_scale := 1.0
var speed := 0.0
var yaw_delta := 0.0
var carrying := false
var work_clip := ""
var active_clip := ""
var snapshot: Dictionary = {}
var grounding_shadow: MeshInstance3D

func _ready() -> void:
	grounding_shadow = MeshInstance3D.new()
	var vertices := PackedVector3Array([Vector3.ZERO])
	for index in 25:
		var angle := TAU * index / 24.0
		vertices.append(Vector3(cos(angle), 0, sin(angle)))
	var indices := PackedInt32Array()
	for index in 24: indices.append_array([0, index + 1, index + 2])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	material.albedo_color = Color("15251f", 0.2)
	material.render_priority = -1
	mesh.surface_set_material(0, material)
	grounding_shadow.mesh = mesh
	grounding_shadow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(grounding_shadow)

func _set_shadow(customer: bool, world_scale: float) -> void:
	grounding_shadow.position.y = 0.008 * world_scale
	grounding_shadow.scale = Vector3(0.58 if customer else 0.6, 1, 0.34 if customer else 0.35) * world_scale


func configure_avatar(config: Dictionary, world_scale: float = 1.0) -> void:
	var tier := CharacterPresentation.character_model_tier_for_capabilities(CharacterPresentation.current_character_capabilities())
	var signature := JSON.stringify([config, tier])
	if appearance == signature: return
	appearance = signature
	var body: String = config.body
	avatar_body = body
	identity = 0
	facial = FacialController.new({"adult-man": 1, "adult-woman": 2, "boy": 3, "girl": 4}[body])
	var path := "res://assets/models/market/characters/%s%s.glb" % [BODY_FILES[body], "_bald" if config.hat == "none" else ""]
	render_scale = BODY_SCALE[body] * CharacterScale.character_scene_scale(body) * world_scale
	model_tier = tier
	_load_rig(CharacterPresentation.character_model_path_for_tier(path, model_tier), render_scale)
	_set_shadow(false, render_scale)
	for mesh in model.find_children("*", "MeshInstance3D", true, false):
		for surface in mesh.mesh.get_surface_count():
			var material: Material = SourcePbr.source_material(mesh, surface)
			if not material is StandardMaterial3D: continue
			var material_name := material.resource_name.to_lower()
			if material_name in ["skin", "skinblush"]: material.albedo_color = Color(config.skin)
			elif material_name == "shirt": material.albedo_color = Color(config.shirt)
			elif material_name == "secondarycloth": material.albedo_color = Color(config.shirt) * 0.78
			elif "hair" in material_name: material.albedo_color = Color(config.hairColor)
	var skeletons := model.find_children("*", "Skeleton3D", true, false)
	if not skeletons.is_empty():
		skeleton = skeletons[0]
		var attachment := BoneAttachment3D.new()
		attachment.bone_name = "Head"
		skeleton.add_child(attachment)
		var accessory_path := "res://assets/models/market/%s/%s/%s.glb" % ["hair" if config.hat == "none" else "hats", body, config.hair if config.hat == "none" else config.hat]
		var accessory: Node3D = load(accessory_path).instantiate()
		attachment.add_child(accessory)
		if config.hat == "none":
			accessory.scale = Vector3(0.5, 0.53, 0.5) if body in ["boy", "girl"] else Vector3(0.38, 0.43, 0.39)
			accessory.position.z = 0.028
		else: accessory.scale = Vector3.ONE * HAT_FIT[body]
		for mesh in accessory.find_children("*", "MeshInstance3D", true, false):
			for surface in mesh.mesh.get_surface_count():
				var material: Material = SourcePbr.source_material(mesh, surface)
				if material is StandardMaterial3D:
					material = material.duplicate()
					material.cull_mode = BaseMaterial3D.CULL_DISABLED
					material.metallic = 0
					material.roughness = 0.62 if "hair" in material.resource_name.to_lower() else clampf(material.roughness * 0.82, 0.58, 0.72)
					if "hair" in material.resource_name.to_lower(): material.albedo_color = Color(config.hairColor)
					mesh.set_surface_override_material(surface, material)

func configure_customer(customer_identity: int) -> void:
	identity = customer_identity
	facial = FacialController.new(identity * 97)
	appearance = str(identity)
	model_tier = CharacterPresentation.character_model_tier_for_capabilities(CharacterPresentation.current_character_capabilities())
	render_scale = CharacterScale.adult_customer_scene_scale(CUSTOMER_SCALE[identity - 1])
	_load_rig(CharacterPresentation.character_model_path_for_tier("res://assets/models/market/customers/%s.glb" % CUSTOMER_FILES[identity - 1], model_tier), render_scale)
	_set_shadow(true, render_scale)
	if cart == null:
		cart = CustomerCartPresentation.new()
		add_child(cart)
		shopping_bag = AuthoredScene.new()
		add_child(shopping_bag)
		shopping_bag.load_part("customer-bag")

## Static per-phase timing, aggregated the same way as
## RecoveryStorage.take_persist_stats(): drained and folded into the
## one-minute-window telemetry report so the real _load_rig() bottleneck can
## be identified from device data instead of guessed at. Caching the finished
## customer material (see prepare_character_model) did not move
## actorCreationMaxMs at all on the next real sample — the cost is somewhere
## else in this function, and this pinpoints exactly where.
static var _phase_max_ms := {}

static func _record_phase(phase: String, duration_ms: int) -> void:
	if not _phase_max_ms.has(phase) or duration_ms >= _phase_max_ms[phase]: _phase_max_ms[phase] = duration_ms

## Drains and resets the stats gathered since the last call.
static func take_rig_phase_stats() -> Dictionary:
	var stats := {}
	for phase in _phase_max_ms:
		var key: String = "rig" + phase[0].to_upper() + phase.substr(1) + "MaxMs"
		stats[key] = _phase_max_ms[phase]
	_phase_max_ms = {}
	return stats

func _load_rig(path: String, factor: float) -> void:
	if model != null:
		remove_child(model)
		model.queue_free()
	var call_start := Time.get_ticks_msec()
	var phase_start := call_start
	var source: Node3D = load(path).instantiate()
	_record_phase("instantiate", Time.get_ticks_msec() - phase_start)
	# Customers (identity > 0) never get a per-instance color customization
	# after this (see configure_customer), so every spawn of the same
	# identity can safely share one cached finished material. Employees and
	# the player (identity 0) go through configure_avatar right after this,
	# which mutates these materials' albedo in place per instance — sharing
	# would bleed one character's colors onto every other one using the same
	# base body GLB, so they keep their own always-duplicated materials.
	phase_start = Time.get_ticks_msec()
	model = CharacterPresentation.prepare_character_model(source, {"crowd": identity > 0, "reducedDetail": model_tier > 0, "shareFinish": identity > 0})
	_record_phase("prepareModel", Time.get_ticks_msec() - phase_start)
	source.free()
	model.scale = Vector3.ONE * factor
	add_child(model)
	phase_start = Time.get_ticks_msec()
	skeleton = model.find_children("*", "Skeleton3D", true, false)[0]
	skeleton.skeleton_updated.connect(_update_carry_pose)
	grounding.reset()
	stable_head = null
	face_meshes.clear()
	for mesh in model.find_children("*", "MeshInstance3D", true, false):
		var shapes := {}
		for index in mesh.get_blend_shape_count(): shapes[mesh.mesh.get_blend_shape_name(index)] = index
		if not shapes.is_empty(): face_meshes.append({"mesh": mesh, "shapes": shapes})
	_record_phase("skeletonScan", Time.get_ticks_msec() - phase_start)
	phase_start = Time.get_ticks_msec()
	player = model.find_children("*", "AnimationPlayer", true, false)[0]
	var compose_ms := 0
	var swap_ms := 0
	for library_name in player.get_animation_library_list():
		var compose_start := Time.get_ticks_msec()
		var library := CarrySocket.compose_carry_animation_library(player.get_animation_library(library_name), "%s:%s" % [path, library_name])
		compose_ms += Time.get_ticks_msec() - compose_start
		var swap_start := Time.get_ticks_msec()
		player.remove_animation_library(library_name)
		player.add_animation_library(library_name, library)
		swap_ms += Time.get_ticks_msec() - swap_start
	_record_phase("animationLibrarySwap", Time.get_ticks_msec() - phase_start)
	# compose_carry_animation_library() is cached per source library instance
	# (a repeat identity should hit it near-instantly); remove/add_animation_library
	# are Godot's own AnimationPlayer calls and pay their own cost regardless of
	# caching. Split out directly in the session log (not just the one-minute
	# aggregate) since the aggregate keeps missing the startup burst.
	if compose_ms + swap_ms >= PerformanceLog.THRESHOLD_MS: PerformanceLog.record("animation_library_swap", compose_ms + swap_ms, {"compose": compose_ms, "removeAdd": swap_ms, "identity": identity})
	phase_start = Time.get_ticks_msec()
	clips.clear()
	actions.clear()
	for animation_name in player.get_animation_list():
		var short_name: String = animation_name.get_slice("/", animation_name.get_slice_count("/") - 1)
		clips[short_name] = animation_name
		var action := LocomotionController.LocomotionAction.new(short_name, player.get_animation(animation_name).length)
		actions[short_name] = action
	active_clip = ""
	locomotion = LocomotionController.new()
	var clips_ms := Time.get_ticks_msec() - phase_start
	_record_phase("clipsActionsBuild", clips_ms)
	if clips_ms >= PerformanceLog.THRESHOLD_MS: PerformanceLog.record("clips_actions_build", clips_ms, {"identity": identity, "count": actions.size()})
	PerformanceLog.record("load_rig", Time.get_ticks_msec() - call_start, {"identity": identity, "path": path.get_file()})

func _process(delta: float) -> void:
	if player == null: return
	var requested := work_clip if not work_clip.is_empty() else locomotion.select(speed, yaw_delta, carrying, LocomotionController.CLIP_NATURAL_SPEED["CarryWalk" if carrying else "Walk"] * render_scale)
	var time_scale: Variant = LocomotionController.gait_time_scale(requested, speed, render_scale) if speed > 0 else null
	locomotion.transition(actions, requested, time_scale if time_scale != null else 1.0)
	var selected := locomotion.current()
	if selected not in clips: return
	var action: LocomotionController.LocomotionAction = actions[selected]
	if active_clip != selected:
		active_clip = selected
		player.play(clips[selected], 0.2)
		player.seek(action.time, true)
	player.speed_scale = action.get_effective_time_scale()
	if identity > 0:
		var unit_key := "%s:%s" % [checkout_loading.transactionId, checkout_loading.unitIndex] if checkout_loading != null else ""
		if not unit_key.is_empty() and unit_key != checkout_unit_key and selected == "CheckoutItem": player.seek(0, true)
		checkout_unit_key = unit_key
		if checkout_loading != null and selected == "CheckoutItem": player.speed_scale = player.get_animation(clips[selected]).length / (CustomerCartMotion.CUSTOMER_CHECKOUT_ITEM_CYCLE_MS / 1000.0)

	action.time = player.current_animation_position
	for foot in locomotion.foot_events(action):
		set_meta("last_foot_event", foot)
		if not feedback_source.is_empty() and selected in ["Walk", "Run", "CarryWalk", "CarryRun"]: FeedbackBus.shared().emit("footstep", {"source": feedback_source, "actorId": feedback_actor_id})
	facial_elapsed = external_time if external_time >= 0 else facial_elapsed + delta
	_update_face()
	if cart != null and not customer_runtime.is_empty():
		var moving: bool = selected in ["Enter", "Exit", "Walk", "Run", "BasketWalk"]
		var turn_lean := clampf(-yaw_delta / maxf(0.001, minf(delta, 0.05)) * 0.014, -0.045, 0.045) if moving else 0.0
		var damping := 1 - exp(-7 * minf(delta, 0.05))
		model.rotation.z = lerpf(model.rotation.z, turn_lean, damping)
		model.rotation.x = lerpf(model.rotation.x, -0.012 if moving else 0.0, damping)
		var head := skeleton.find_bone("Head")
		if head >= 0:
			var desired := skeleton.get_bone_pose_rotation(head)
			if stable_head == null: stable_head = desired
			else:
				var angle: float = stable_head.angle_to(desired)
				if angle > 0: stable_head = stable_head.slerp(desired, minf(1, minf(delta, 0.05) * 1.8 / angle))
			skeleton.set_bone_pose_rotation(head, stable_head)
		cart.update_inventory(customer_runtime, checkout_transaction, model_tier > 0)
		cart.animate(self, customer_runtime, checkout_loading, delta)
		_update_pickup(delta)
		var receiving: bool = customer_runtime.state == "TAKE_BAG"
		shopping_bag.visible = receiving or (customer_runtime.hasBag and not customer_runtime.hasCart)
		if shopping_bag.visible:
			var hand := skeleton.find_bone("Hand_L")
			shopping_bag.position = to_local(skeleton.global_transform * skeleton.get_bone_global_pose(hand).origin)
			var bag_scale := 0.72 + CustomerCartMotion.eased_motion_progress(cart.clock_ms - cart.state_started, 520) * 0.28 if receiving else 1.0
			shopping_bag.scale = Vector3.ONE * render_scale * bag_scale
			shopping_bag.rotation = model.rotation
	if identity == 0:
		var lowest := INF
		for bone in ["Foot_L", "Foot_R"]:
			var index := skeleton.find_bone(bone)
			if index >= 0: lowest = minf(lowest, (skeleton.global_transform * skeleton.get_bone_global_pose(index)).origin.y)
		if is_finite(lowest):
			grounding.calibrate(lowest, 0)
			var correction := grounding.solve(lowest, 0, LocomotionController.locomotion_grounding_support(selected))
			model.position.y = lerpf(model.position.y, correction / maxf(0.001, global_transform.basis.get_scale().y), 0.24)

func update_carry(carry: Dictionary) -> void:
	carrying = CarrySystem.carry_total(carry) > 0
	if basket == null and carrying:
		carry_frame = Node3D.new()
		add_child(carry_frame)
		basket = HarvestBasketPresentation.new()
		carry_frame.add_child(basket)
	if basket == null: return
	carry_frame.scale = Vector3.ONE * render_scale
	basket.update(carry)
	_update_carry_pose()

func _update_carry_pose() -> void:
	if basket == null or not carrying or skeleton == null: return
	var left := skeleton.find_bone("Hand_L")
	var right := skeleton.find_bone("Hand_R")
	if left < 0 or right < 0: return
	var offsets: Dictionary = CarrySocket.CHARACTER_PALM_OFFSETS[avatar_body]
	var left_palm := CarrySocket.hand_palm_point(skeleton.global_transform * skeleton.get_bone_global_pose(left), offsets.left)
	var right_palm := CarrySocket.hand_palm_point(skeleton.global_transform * skeleton.get_bone_global_pose(right), offsets.right)
	basket.place(carry_frame.to_local(left_palm), carry_frame.to_local(right_palm))

func _update_face() -> void:
	if facial == null or facial_elapsed - last_facial_update < CharacterPresentation.character_face_update_interval(model_tier, identity > 0): return
	last_facial_update = facial_elapsed
	var expression := "Neutral"
	if active_clip == "Happy" or (identity > 0 and active_clip == "ReceiveBag"): expression = "Happy"
	elif active_clip == "Confused": expression = "Confused"
	elif identity > 0 and (active_clip == "Impatient" or customer_runtime.get("state") == "WAIT_RESTOCK" or customer_runtime.get("angry", false)): expression = "Impatient"
	var weights := facial.weights(facial_elapsed + identity * 0.21, expression)
	if identity > 0 and active_clip in ["Browse", "ReachShelf", "CheckoutItem"]:
		weights.BrowDown_L = 0.22
		weights.BrowDown_R = 0.22
	for entry in face_meshes:
		for shape in ["Blink_L", "Blink_R", "EyeWide_L", "EyeWide_R", "BrowUp_L", "BrowUp_R", "BrowDown_L", "BrowDown_R", "Smile", "CheekUp", "Frown", "JawOpen", "MouthNarrow", "Surprise", "Confused"]:
			if shape in entry.shapes: entry.mesh.set_blend_shape_value(entry.shapes[shape], weights.get(shape, 0))
		if identity == 0 and "MouthOpen" in entry.shapes: entry.mesh.set_blend_shape_value(entry.shapes.MouthOpen, maxf(0, sin(facial_elapsed * 10)) * 0.42 if active_clip == "Talk" else 0)

func current_product() -> String:
	var lines: Array = customer_runtime.get("shoppingList", [])
	var index: int = customer_runtime.get("currentLine", 0)
	return lines[index].productId if index >= 0 and index < lines.size() else ""

func _update_pickup(delta: float) -> void:
	var product := current_product()
	if product != pickup_product:
		if pickup_visual != null:
			remove_child(pickup_visual)
			pickup_visual.queue_free()
		pickup_visual = null
		pickup_product = product
		if not product.is_empty():
			pickup_visual = Node3D.new()
			add_child(pickup_visual)
			var item: Node3D = cart.templates[product].duplicate()
			item.scale = Vector3.ONE * 1.35
			pickup_visual.add_child(item)
			var ring := MeshInstance3D.new()
			var mesh := ArrayMesh.new()
			var vertices := PackedVector3Array()
			for index in 18:
				var a := TAU * index / 18
				var b := TAU * (index + 1) / 18
				var ia := Vector3(cos(a), 0, sin(a)) * 0.1
				var ib := Vector3(cos(b), 0, sin(b)) * 0.1
				var oa := Vector3(cos(a), 0, sin(a)) * 0.16
				var ob := Vector3(cos(b), 0, sin(b)) * 0.16
				vertices.append_array([oa, ob, ia, ia, ob, ib])
			var arrays := []
			arrays.resize(Mesh.ARRAY_MAX)
			arrays[Mesh.ARRAY_VERTEX] = vertices
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
			ring.mesh = mesh
			var material := StandardMaterial3D.new()
			material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			material.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
			material.albedo_color = Color("ffe394", 0.72)
			ring.material_override = material
			ring.position.y = -0.11
			ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			pickup_visual.add_child(ring)
	if pickup_visual == null: return
	var right := skeleton.find_bone("Hand_R")
	pickup_visual.visible = customer_runtime.state == "PICK_PRODUCT" and cart.visible and right >= 0
	if not pickup_visual.visible: return
	var display := RetailLayout.retail_display_position(RetailLayout.PRODUCT_RETAIL_DEPARTMENT[product])
	var dx: float = position.x - display[0] * 2
	var dz: float = position.z - display[2] * 2
	var distance := maxf(0.001, Vector2(dx, dz).length())
	var lateral := (-0.42 if product in ["tomatoes", "milk"] else (0.42 if product in ["corn", "cheese"] else 0.0)) * 1.6
	var source := to_local(get_parent().to_global(Vector3(display[0] * 2 + dx / distance * 0.92 * 1.6 - dz / distance * lateral, PICKUP_HEIGHT[product] * 1.6, display[2] * 2 + dz / distance * 0.92 * 1.6 + dx / distance * lateral)))
	var hand := to_local(skeleton.global_transform * skeleton.get_bone_global_pose(right).origin)
	var target := to_local(cart.basket.global_position)
	var progress := CustomerCartMotion.motion_progress(cart.clock_ms - cart.state_started, CustomerCartMotion.CUSTOMER_PICKUP_DURATION_MS)
	var point := CustomerCartMotion.product_transfer_point([source.x, source.y, source.z], [hand.x, hand.y, hand.z], [target.x, target.y, target.z], progress)
	pickup_visual.position = Vector3(point[0], point[1], point[2])
	pickup_visual.rotation.y += minf(delta, 0.05) * 4.8
