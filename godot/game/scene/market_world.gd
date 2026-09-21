class_name MarketWorld
extends Node3D
signal orders_requested
const Authored = preload("res://game/scene/authored_scene.gd")
const Actor = preload("res://game/scene/market_actor.gd")
const Zones = preload("res://game/scene/interaction_zones.gd")
const Game = preload("res://game/engine.gd")
const Progression = preload("res://game/core/engine_progression.gd")
var lighting := SourcePbr.new()
var rendering := MarketRenderRuntime.new()
var transmission := MarketGlassTransmission.new()
var checkout := CheckoutPresentation.new()
var production := ProductionPresentation.new()
var transfers := TransferBurstPresentation.new()
var store: MarketStore
var presentation_ready := true
var driveable := true:
	set(value):
		driveable = value
		if not value:
			input.clear_all()
			joystick.end()
			joystick_thumb = Vector2.ZERO
var cash_markers := preload("res://game/scene/cash_markers.gd").new()
var crops := preload("res://game/scene/farm_crops.gd").new()
var inventory := preload("res://game/scene/retail_inventory.gd").new()
var parts: Dictionary = {}
var actors: Dictionary = {}
var world := Node3D.new()
var player_body := CharacterBody3D.new()
var player_actor := Actor.new()
var camera := Camera3D.new()
var static_bodies := Node3D.new()
var environment := Environment.new()
var sun := DirectionalLight3D.new()
var director: InteractionDirector
var last_work_id := ""
var last_work_until := 0
var workstation := WorkstationController.new()
var input := InputManager.new()
var motion_velocity := Vector2.ZERO
var angular_velocity := 0.0
var checkout_camera_blend := 0.0
var camera_zoom := 1.0
var unreported_distance := 0.0
var zone_signature := ""
var structure_signature := ""
var joystick := DragJoystick.new()
var joystick_thumb := Vector2.ZERO
var door_leaves: Array = []
var presentation_elapsed := 0.0
var front_door_progress := 0.0
var rear_door_motion := StorefrontLayout.CLOSED_REAR_DOOR_MOTION.duplicate()
var rear_door_leaves: Array = []
var rear_door_visual: Node3D
var rear_door_indicator: StandardMaterial3D
var front_door_indicator: StandardMaterial3D

## Populated by _ready()'s authored-scene load; reported as telemetry so the
## dominant startup-freeze contributor can be identified from real devices
## without needing Xcode Instruments or the Godot editor's remote profiler.
var load_timings_ms: Dictionary = {}

func _ready() -> void:
	var ready_start := Time.get_ticks_msec()
	world.name = "AuthoredWorld"
	world.add_child(cash_markers)
	world.add_child(transfers)
	world.add_child(production)
	world.add_child(checkout)
	transfers.landed.connect(_refresh_visual_inventory)
	world.scale = Vector3.ONE * WorldScale.WORLD_SCALE
	add_child(world)
	for part in ["ground", "city", "building", "furniture", "farm", "closed-checkouts"]:
		var part_start := Time.get_ticks_msec()
		var content := Authored.new()
		world.add_child(content)
		content.load_part(part)
		parts[part] = content
		load_timings_ms[part.replace("-", "_") + "_ms"] = Time.get_ticks_msec() - part_start
	var rear_start := Time.get_ticks_msec()
	var rear := Authored.new()
	add_child(rear)
	rear.load_part("rear-door")
	parts["rear-door"] = rear
	load_timings_ms["rear_door_ms"] = Time.get_ticks_msec() - rear_start
	var doors_start := Time.get_ticks_msec()
	for entry in rear.manifest.manifest:
		if entry.sourceName == "dynamic:rear-farm-door": rear_door_visual = rear.nodes[entry.name]
	rear_door_indicator = SourcePbr.source_material(rear_door_visual.get_child(2).get_child(1), 0)
	for node in parts.building.nodes.values():
		if node.get_meta("source_name", "") == "dynamic:storefront-door":
			front_door_indicator = SourcePbr.source_material(node.get_child(node.get_child_count() - 1).get_child(1))
	front_door_progress = Progression.current_franchise(store.game).doorProgress
	load_timings_ms["doors_ms"] = Time.get_ticks_msec() - doors_start
	var bind_start := Time.get_ticks_msec()
	inventory.bind(parts.furniture)
	load_timings_ms["inventory_bind_ms"] = Time.get_ticks_msec() - bind_start
	bind_start = Time.get_ticks_msec()
	crops.bind(parts.farm)
	load_timings_ms["crops_bind_ms"] = Time.get_ticks_msec() - bind_start
	bind_start = Time.get_ticks_msec()
	production.bind(parts.furniture, parts.farm)
	load_timings_ms["production_bind_ms"] = Time.get_ticks_msec() - bind_start
	bind_start = Time.get_ticks_msec()
	checkout.bind(parts.furniture, production.templates)
	load_timings_ms["checkout_bind_ms"] = Time.get_ticks_msec() - bind_start
	var environment_start := Time.get_ticks_msec()
	add_child(static_bodies)
	var background := WorldEnvironment.new()
	background.environment = environment
	environment.background_mode = Environment.BG_COLOR
	environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color.WHITE
	add_child(background)
	add_child(sun)
	sun.position = Vector3(8, 13, 7) * 3
	sun.look_at(Vector3.ZERO)
	sun.shadow_enabled = true
	add_child(camera)
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.keep_aspect = Camera3D.KEEP_HEIGHT
	camera.near = 0.3
	camera.far = 360
	camera.current = true
	player_body.name = "Player"
	player_body.position = Vector3(0, 0, 6.25 * 2) * 3
	player_body.safe_margin = 0.03
	add_child(player_body)
	var collision := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.24 * 3
	capsule.height = (0.45 * 2 + 0.24 * 2) * 3
	collision.shape = capsule
	collision.position.y = 0.69 * 3
	player_body.add_child(collision)
	player_body.add_child(player_actor)
	player_actor.feedback_source = "player"
	player_actor.feedback_actor_id = "player"
	load_timings_ms["environment_setup_ms"] = Time.get_ticks_msec() - environment_start
	store.changed.connect(sync_state)
	var sync_start := Time.get_ticks_msec()
	sync_state()
	load_timings_ms["sync_state_ms"] = Time.get_ticks_msec() - sync_start
	lighting.scope = self
	add_child(lighting)
	rendering.world = self
	add_child(rendering)
	transmission.world = self
	add_child(transmission)
	load_timings_ms["total_ms"] = Time.get_ticks_msec() - ready_start

func sync_state() -> void:
	if store.game == null: return
	var state: Dictionary = store.game
	var franchise := Progression.current_franchise(state)
	front_door_indicator.albedo_color = Color("72e8a9" if franchise.open else "f08d73")
	front_door_indicator.emission = Color("2fac74" if franchise.open else "b84f38")
	SourcePbr.touch(front_door_indicator)
	player_actor.configure_avatar(state.avatar, 3)
	player_actor.update_carry(visual_franchise(franchise).carry)
	var appearance := BusinessDay.daylight_presentation(state.minuteOfDay)
	environment.background_color = Color(appearance.background)
	environment.ambient_light_energy = 0
	lighting.update_daylight(appearance)
	sun.light_energy = appearance.keyIntensity / PI
	sun.light_color = Color(appearance.keyColor)
	var structure: String = franchise.id + ":" + str(franchise.unlockedAreas)
	if structure != structure_signature:
		structure_signature = structure
		_build_collisions(franchise.unlockedAreas)
		_update_fixture_visibility(franchise)
	var crop_ids: Array = franchise.crops.filter(func(crop): return crop.status != "LOCKED").map(func(crop): return crop.id)
	var purchases: Array = Game.campaign_purchase_quotes(state).filter(func(quote): return quote.available).map(func(quote): return quote.id) if franchise.get("purchases") != null else []
	var signature := str([structure, crop_ids, purchases, franchise.checkoutLevel])
	if signature != zone_signature:
		zone_signature = signature
		director = InteractionDirector.new(Zones.configs(franchise.checkoutLevel, franchise.unlockedAreas, crop_ids, purchases))
		workstation = WorkstationController.new()
	_refresh_visual_inventory()
	cash_markers.update(state)
	production.update(franchise)
	checkout.update(franchise)
	_sync_actors(franchise)
	for animal in parts.farm.animals:
		var machine_id := "cow-station-1" if animal.kind == "cow" else "chicken-coop-1"
		if animal.kind == "chicken":
			var parent: Node = animal.anchor
			while parent != null:
				if parent.has_meta("authored"):
					var station: Array = parent.get_meta("authored").authoredPosition
					if _same_position(station, FarmLayout.FARM_ANIMAL_STATIONS.chicken2.position): machine_id = "chicken-coop-2"
					break
				parent = parent.get_parent()
		var machine: Variant = Progression.find_id(franchise.productionMachines, machine_id)
		animal.active = machine != null and machine.status == "PROCESSING"

func visual_franchise(franchise: Dictionary) -> Dictionary:
	var presentation := VisualTransferLedger.derive_visual_transfer_presentation(franchise.carry, franchise.crops, franchise.shelves, transfers.entries)
	var result := franchise.duplicate()
	result.merge(presentation, true)
	return result

func _refresh_visual_inventory() -> void:
	if store.game == null: return
	var franchise := visual_franchise(Progression.current_franchise(store.game))
	player_actor.update_carry(franchise.carry)
	crops.update(franchise, store.game.simulationTimeMs)
	inventory.update(franchise)

func _sync_actors(franchise: Dictionary) -> void:
	var present := {}
	for customer in franchise.customers:
		var id: String = customer.id
		present[id] = true
		if id not in actors:
			var actor := Actor.new()
			world.add_child(actor)
			actor.configure_customer(customer.identity)
			actors[id] = actor
		var actor: Actor = actors[id]
		actor.snapshot = CustomerVisualMotion.capture_customer_motion(customer, Time.get_ticks_msec())
		actor.customer_runtime = customer
		if actor.model_tier != CharacterPresentation.character_model_tier_for_capabilities(CharacterPresentation.current_character_capabilities()): actor.configure_customer(customer.identity)
		actor.visible = customer.state != "DESPAWN"
	for index in franchise.employees.size():
		var employee: Dictionary = franchise.employees[index]
		var id: String = employee.id
		present[id] = true
		if id not in actors:
			var actor := Actor.new()
			world.add_child(actor)
			actors[id] = actor
		if employee.get("runtime") == null: continue
		var actor: Actor = actors[id]
		actor.configure_avatar({"body": "adult-woman" if index % 2 == 0 else "adult-man", "hair": ["ponytail", "fade", "bun", "waves"][index % 4], "skin": "#a96f50", "shirt": ["#e7a959", "#6b9fc8", "#b56fa6", "#70a85d"][index % 4], "hairColor": "#3b2820", "hat": employee.hat})
		actor.employee_role = employee.role
		actor.employee_state = employee.runtime.state
		actor.feedback_source = "npc"
		actor.feedback_actor_id = id
		actor.snapshot = CustomerVisualMotion.capture_employee_motion(employee.runtime, Time.get_ticks_msec())
		actor.update_carry(employee.runtime.carry)
		actor.work_clip = ""
		if employee.runtime.state in ["PICKUP", "DROPOFF", "RETURN_TO_WAREHOUSE", "OPERATE_CHECKOUT"]:
			actor.work_clip = "StockLow" if employee.runtime.state == "RETURN_TO_WAREHOUSE" else {"farmer": "Harvest", "feeder": "PickupLow", "operator": "LiftBox", "stocker": "StockHigh", "cashier": "ScanItem", "builder": "CarryBox", "manager": "Wave"}[employee.role]
	for id in actors.keys():
		if id not in present:
			actors[id].queue_free()
			actors.erase(id)

func _physics_process(delta: float) -> void:
	if store == null or store.game == null or director == null: return
	var franchise := Progression.current_franchise(store.game)
	if driveable and presentation_ready:
		input.set_keyboard(float(Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT)) - float(Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT)), float(Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN)) - float(Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP)))
		var pads := Input.get_connected_joypads()
		input.set_gamepad(Input.get_joy_axis(pads[0], JOY_AXIS_LEFT_X) if not pads.is_empty() else 0, Input.get_joy_axis(pads[0], JOY_AXIS_LEFT_Y) if not pads.is_empty() else 0)
	else: input.clear_all()
	var sample := input.sample()
	var locked := workstation.update_input(sample.magnitude)
	var intention := Vector2.ZERO if locked else PlayerController.camera_relative_movement(sample, Vector2(-16, -25.75))
	var config := PlayerController.player_motion_for_tier(franchise.playerSpeedTier, Game.is_campaign_game(store.game))
	for key in ["walkSpeed", "acceleration", "braking"]: config[key] *= WorldScale.WORLD_SCALE
	motion_velocity = Vector2.ZERO if locked else PlayerController.move_velocity(motion_velocity, intention, delta, config)
	player_body.velocity = Vector3(motion_velocity.x, -0.025 / delta, motion_velocity.y)
	var previous := player_body.position
	player_body.move_and_slide()
	player_body.position.y = maxf(0, player_body.position.y)
	unreported_distance += Vector2(player_body.position.x - previous.x, player_body.position.z - previous.z).length() / 3
	if unreported_distance >= 1:
		store.record_player_distance(unreported_distance)
		unreported_distance = 0
	var events := director.update("player", player_body.position.x / 3, player_body.position.z / 3, Time.get_ticks_msec())
	var selected: Variant = null
	for id in WorkstationLayout.WORKSTATION_IDS:
		if _locks_movement(id) and id in director.selected_zone_ids():
			selected = id
			break
	workstation.sync(selected, sample.magnitude)
	for event in events:
		if event.zone.id == "door" and event.signal in ["enter", "exit"]: store.dispatch({"type": "DOOR_SENSOR", "active": event.signal == "enter"})
		if not driveable or (event.zone.id == "orders" and sample.magnitude > 0.05): continue
		if event.signal == "tick" and (not _locks_movement(event.zone.id) or workstation.can_perform(event.zone.id)): _interact(event.zone.id)

static func _locks_movement(id: String) -> bool:
	return WorkstationLayout.is_workstation_id(id) and id != "shelf" and not ProductionLayout.is_production_workstation_id(id)

func _process(delta: float) -> void:
	if store == null or store.game == null or not is_instance_valid(player_actor): return
	presentation_elapsed += delta
	crops.animate(delta)
	checkout.animate(delta)
	transfers.basket_target = world.to_local(player_actor.basket.global_position) if is_instance_valid(player_actor.basket) and player_actor.basket.visible else world.to_local(player_body.position) + Vector3(0, 1.05, 0)
	transfers.advance(delta)
	var current_franchise := Progression.current_franchise(store.game)
	for customer in current_franchise.customers:
		if customer.id not in actors: continue
		var actor: Actor = actors[customer.id]
		var transaction: Variant = Progression.find_id(current_franchise.checkoutTransactions, customer.transactionId) if customer.transactionId != null else null
		var loading: Variant = CustomerCartMotion.checkout_loading_presentation(customer.state, transaction, int(store.game.simulationTimeMs))
		actor.checkout_transaction = transaction
		actor.checkout_loading = loading
		var runs_free: bool = actor.snapshot.get("speed", 0) * 2 > LocomotionController.RUN_GAIT_RATIO.start * LocomotionController.CLIP_NATURAL_SPEED.Walk * actor.render_scale
		actor.work_clip = CustomerAnimationPresentation.select(customer, store.game.simulationTimeMs, presentation_elapsed, loading != null, runs_free)
	var step := minf(delta, 0.05)
	player_actor.external_time = presentation_elapsed
	player_actor.speed = motion_velocity.length()
	var work_id: Variant = workstation.performing_zone_id()
	player_actor.work_clip = ""
	if player_actor.speed <= 0.12 and work_id == last_work_id and Time.get_ticks_msec() < last_work_until:
		player_actor.work_clip = {"mill": "LiftBox", "bakery": "StockHigh", "chicken": "PickupLow", "cow": "PickupLow", "cheese": "LiftBox", "juice": "LiftBox", "checkout": "ScanItem", "warehouseReturn": "StockLow", "door": "Enter"}.get(last_work_id, "")
	if workstation.snapshot().locked:
		var heading: float = WorkstationLayout.WORKSTATIONS[work_id].facing
		var turn := PlayerController.smooth_yaw(player_actor.rotation.y, heading, angular_velocity, step)
		player_actor.yaw_delta = heading - player_actor.rotation.y
		player_actor.rotation.y = turn.yaw
		angular_velocity = turn.angularVelocity
	elif player_actor.speed > 0.08:
		var heading := atan2(motion_velocity.x, motion_velocity.y)
		var turn := PlayerController.smooth_yaw(player_actor.rotation.y, heading, angular_velocity, step)
		player_actor.yaw_delta = heading - player_actor.rotation.y
		player_actor.rotation.y = turn.yaw
		angular_velocity = turn.angularVelocity
	_update_camera(delta, work_id == "checkout")
	for actor in actors.values():
		actor.external_time = presentation_elapsed
		if actor.snapshot.is_empty(): continue
		var projected := CustomerVisualMotion.project_customer_motion(actor.snapshot, Time.get_ticks_msec())
		var next := Vector3(projected.x * 2, 0, projected.z * 2)
		actor.speed = actor.position.distance_to(next) / maxf(0.001, step)
		actor.position = next
		var heading_before: float = actor.rotation.y
		var desired_yaw: Variant = CheckoutLayout.checkout_customer_facing_yaw(actor.customer_runtime, [projected.x, projected.z]) if actor.identity > 0 else null
		if desired_yaw != null: actor.rotation.y = Locomotion.turn_towards(actor.rotation.y, desired_yaw, step * 3.8)
		elif actor.identity == 0 and actor.employee_role == "cashier" and actor.employee_state in ["OPERATE_CHECKOUT", "WAIT_CHECKOUT_STATION"]:
			actor.rotation.y = Locomotion.turn_towards(actor.rotation.y, PI, step * 3.5)
		elif (actor.identity > 0 or actor.employee_state in ["NAVIGATE_PICKUP", "NAVIGATE_DROPOFF", "NAVIGATE_RETURN", "NAVIGATE_CHECKOUT"]) and absf(projected.headingX) + absf(projected.headingZ) > 0.5:
			actor.rotation.y = Locomotion.turn_towards(actor.rotation.y, atan2(projected.headingX, projected.headingZ), step * (3.35 if actor.identity > 0 else 3))
		elif actor.identity > 0 and actor.customer_runtime.get("state") in ["WAIT_FOR_ACCESS", "PICK_PRODUCT", "WAIT_RESTOCK"] and not actor.current_product().is_empty():
			var display := RetailLayout.retail_display_position(RetailLayout.PRODUCT_RETAIL_DEPARTMENT[actor.current_product()])
			actor.rotation.y = Locomotion.turn_towards(actor.rotation.y, atan2(display[0] * 2 - actor.position.x, display[2] * 2 - actor.position.z), step * 3.8)
		actor.yaw_delta = CustomerCartMotion.shortest_heading_delta(heading_before, actor.rotation.y)
	var franchise := Progression.current_franchise(store.game)
	var target: float = 1 if franchise.doorState in ["OPENING", "OPEN"] else (0 if franchise.doorState in ["CLOSING", "CLOSED"] else StorefrontLayout.storefront_door_progress(franchise.doorProgress))
	front_door_progress = move_toward(front_door_progress, target, step * 1000 / 450.0)
	for index in door_leaves.size():
		door_leaves[index].position.x = StorefrontLayout.storefront_door_leaf_center(-1 if index == 0 else 1, front_door_progress) * 6
	for entry in parts.building.manifest.manifest:
		if entry.sourceName == "dynamic:storefront-door":
			var door: Node3D = parts.building.nodes[entry.name]
			for index in 2: door.get_child(index).position.x = StorefrontLayout.storefront_door_leaf_center(-1 if index == 0 else 1, front_door_progress)
	var rear_occupied := StorefrontLayout.rear_door_actor_present([player_body.position.x / 6, player_body.position.z / 6])
	for employee in franchise.employees:
		if employee.get("runtime") != null and StorefrontLayout.rear_door_actor_present([employee.runtime.x, employee.runtime.z]): rear_occupied = true
	rear_door_motion = StorefrontLayout.advance_rear_door_motion(rear_door_motion, rear_occupied, delta * 1000)
	for index in 2:
		var center := StorefrontLayout.rear_door_leaf_center(-1 if index == 0 else 1, rear_door_motion.progress)
		rear_door_visual.get_child(index).position.x = center
		rear_door_leaves[index].position.x = center * 6
	var opened: bool = rear_door_motion.progress > 0.98
	rear_door_indicator.albedo_color = Color("79ecad" if opened else "f0bd66")
	rear_door_indicator.emission = Color("36a878" if opened else "9d681d")
	SourcePbr.touch(rear_door_indicator)

func _notification(what: int) -> void:
	if what in [NOTIFICATION_APPLICATION_FOCUS_OUT, NOTIFICATION_APPLICATION_PAUSED]:
		input.clear_all()
		joystick.end()

func _input(event: InputEvent) -> void:
	# Release remains observable when the pointer ends over an interactive HUD.
	if event is InputEventScreenTouch and not event.pressed:
		if joystick.end(event.index): input.clear_pointer()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and not event.pressed:
		if joystick.end(-1): input.clear_pointer()

func _unhandled_input(event: InputEvent) -> void:
	if not driveable or not presentation_ready: return
	var viewport := get_viewport().get_visible_rect().size
	if event is InputEventScreenTouch:
		if event.pressed:
			joystick_thumb = Vector2.ZERO
			joystick.begin(event.index, event.position.x, event.position.y, viewport.x, viewport.y)
		elif joystick.end(event.index): input.clear_pointer()
	elif event is InputEventScreenDrag:
		var sample: Variant = joystick.move(event.index, event.position.x, event.position.y)
		if sample != null:
			input.set_pointer(sample.input)
			joystick_thumb = Vector2(sample.thumbX, sample.thumbY)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			joystick_thumb = Vector2.ZERO
			joystick.begin(-1, event.position.x, event.position.y, viewport.x, viewport.y)
		elif joystick.end(-1): input.clear_pointer()
	elif event is InputEventMouseMotion and joystick.pointer_id == -1:
		var sample: Variant = joystick.move(-1, event.position.x, event.position.y)
		if sample != null:
			input.set_pointer(sample.input)
			joystick_thumb = Vector2(sample.thumbX, sample.thumbY)

func _interact(id: String) -> void:
	var pending_before := store.pending_interactions.size()
	var state: Dictionary = store.game
	var franchise := Progression.current_franchise(state)
	if FarmLayout.is_farm_interaction_id(id):
		var crop: Variant = Progression.find_id(franchise.crops, FarmLayout.crop_id_from_farm_interaction(id))
		if crop != null and crop.status == "READY" and CarrySystem.carry_total(franchise.carry) < franchise.carry.capacity:
			store.queue_interaction({"type": "HARVEST", "cropId": crop.id, "productId": crop.productId, "quantity": mini(crop.available, franchise.carry.capacity - CarrySystem.carry_total(franchise.carry))})
		elif crop != null and crop.status == "EMPTY": store.queue_interaction({"type": "TEND_CROP", "cropId": crop.id, "productId": crop.productId})
	var machines := {"mill": "flour-mill-1", "bakery": "bread-oven-1", "chicken": "chicken-coop-1", "chicken2": "chicken-coop-2", "cow": "cow-station-1", "cheese": "cheese-maker-1", "juice": "juice-machine-1", "canner": "corn-canner-1"}
	if id in machines and Game.can_operate_machine(franchise, machines[id], state.simulationTimeMs):
		store.queue_interaction({"type": "LOAD_FLOUR_MILL"} if id == "mill" else ({"type": "BAKE_BREAD"} if id == "bakery" else {"type": "OPERATE_MACHINE", "machineId": machines[id]}))
	var department: Variant = RetailLayout.retail_department_from_stocking_interaction(id)
	if department != null:
		for pulse in CarrySystem.department_stocking_pulses(franchise.carry, franchise.shelves, franchise.stationTiers.get("shelves-1", franchise.shelvesLevel), RetailLayout.RETAIL_DEPARTMENTS[department].products, franchise.unlockedAreas):
			var action: Dictionary = pulse.duplicate()
			action.merge({"type": "STOCK", "source": "carry"})
			store.queue_interaction(action)
	if id == "checkout" and franchise.open and Game.can_process_checkout_unit(state, franchise): store.queue_interaction({"type": "CHECKOUT", "paymentMethod": "card" if franchise.customersToday % 2 else "cash"})
	if PurchaseLayout.is_purchase_interaction_id(id) and state.balanceMinor > 0:
		var purchase_id := PurchaseLayout.purchase_id_from_interaction(id)
		var quotes: Array = Game.campaign_purchase_quotes(state).filter(func(quote): return quote.id == purchase_id and quote.available)
		if not quotes.is_empty(): store.queue_interaction({"type": "CONTRIBUTE_PURCHASE", "purchaseId": purchase_id})
	if RegisterLayout.is_register_interaction_id(id) and franchise.registerCashMinor[RegisterLayout.register_lane(id)] > 0: store.queue_interaction({"type": "COLLECT_REGISTER", "lane": RegisterLayout.register_lane(id)})
	if id == "orders": orders_requested.emit()
	if id in ["warehouseReturn", "farmBarn"] and CarrySystem.carry_total(franchise.carry) > 0: store.queue_interaction({"type": "RETURN_TO_WAREHOUSE"})
	if store.pending_interactions.size() > pending_before:
		for queued in store.pending_interactions.slice(pending_before):
			match queued.type:
				"HARVEST":
					var crop: Dictionary = Progression.find_id(franchise.crops, queued.cropId)
					transfers.add_transfer({"kind": "harvest", "cropId": crop.id, "productId": queued.productId, "quantity": queued.quantity, "cropStart": crop.available, "carryStart": CarrySystem.carry_quantity(franchise.carry, queued.productId)}, franchise.unlockedAreas)
				"STOCK": transfers.add_transfer({"kind": "stock", "productId": queued.productId, "quantity": queued.quantity, "carryStart": CarrySystem.carry_quantity(franchise.carry, queued.productId), "shelfStart": franchise.shelves[queued.productId]}, franchise.unlockedAreas)
				"RETURN_TO_WAREHOUSE":
					for product in CarrySystem.carried_product_ids(franchise.carry):
						var quantity := CarrySystem.carry_quantity(franchise.carry, product)
						transfers.add_transfer({"kind": "return", "productId": product, "quantity": quantity, "carryStart": quantity}, franchise.unlockedAreas)
				"CONTRIBUTE_PURCHASE":
					var quote: Dictionary = Game.campaign_purchase_quotes(state).filter(func(item): return item.id == queued.purchaseId)[0]
					var pulse := minf(state.balanceMinor, minf(quote.remainingMinor, PurchaseState.purchase_contribution_pulse_minor(quote.costMinor)))
					transfers.add_transfer({"kind": "pay", "purchaseId": quote.id, "quantity": mini(8, CashBundles.cash_bundle_count(pulse, CashBundles.cash_bundle_minor(Game.country_money_scale(state.countryCode))))}, franchise.unlockedAreas)
					FeedbackBus.shared().emit("money", {"source": "player", "actorId": "player"})
		last_work_id = id
		last_work_until = Time.get_ticks_msec() + 1050
		var action: Dictionary = store.pending_interactions.back()
		var cue: String = {"HARVEST": "harvest", "STOCK": "stock", "RETURN_TO_WAREHOUSE": "stock"}.get(action.type, {"mill": "machine", "bakery": "machine", "chicken": "pickup", "cow": "pickup", "cheese": "machine", "juice": "machine", "canner": "machine", "checkout": "scanner"}.get(id, ""))
		if not cue.is_empty(): FeedbackBus.shared().emit(cue, {"source": "player", "actorId": "player"})


func _box(center: Vector3, half: Vector3) -> CollisionShape3D:
	var body := StaticBody3D.new()
	static_bodies.add_child(body)
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = half * 2
	shape.shape = box
	shape.position = center
	body.add_child(shape)
	return shape

func _build_collisions(areas: Array) -> void:
	for child in static_bodies.get_children(): child.free()
	door_leaves.clear()
	rear_door_leaves.clear()
	_box(Vector3(0, -0.24, -7.5), Vector3(13.35 * 6, 0.24, 17.15 * 6))
	for obstacle in WorldScale.store_obstacles_for_areas(areas): _box(Vector3(obstacle.x * 3, 2.7, obstacle.z * 3), Vector3(obstacle.halfX * 3, 2.7, obstacle.halfZ * 3))
	for side in [-1, 1]:
		_box(Vector3(side * 11.35 * 6, 8.4, -0.35 * 6), Vector3(0.17 * 6, 8.4, 8.25 * 6))
		_box(Vector3(side * 6.585 * 6, 8.4, 7.78 * 6), Vector3(4.765 * 6, 8.4, 0.12 * 3))
		_box(Vector3(side * 1.82 * 6, 8.34, 7.8 * 6), Vector3(0.05 * 6, 8.34, 0.07 * 6))
		door_leaves.append(_box(Vector3(side * 0.86 * 6, 8.1, 7.8 * 6), Vector3(0.84 * 6, 8.1, 0.0325 * 6)))
	var rear: Dictionary = StorefrontLayout.STORE_REAR_DOOR
	var door: Dictionary = rear.door
	var half_height: float = door.leafHeight / 2
	var frame_half: float = (door.leafHeight + 0.18) / 2
	for side in [-1, 1]:
		_box(Vector3((rear.x + side * door.outerPostOffset) * 6, frame_half * 3, rear.z * 6), Vector3(door.postWidth * 3, frame_half * 3, door.frameDepth * 3))
		rear_door_leaves.append(_box(Vector3(StorefrontLayout.rear_door_leaf_center(side, rear_door_motion.progress) * 6, half_height * 3, rear.z * 6), Vector3(door.leafWidth * 3, half_height * 3, door.leafDepth * 3)))
	_box(Vector3(rear.x * 6, (door.leafHeight + 0.09) * 3, rear.z * 6), Vector3((door.outerPostOffset + door.postWidth / 2) * 6, 0.09 * 3, door.frameDepth * 0.55 * 6))
	for segment in StorefrontLayout.rear_door_wall_segments(): _box(Vector3(segment.centerX * 6, 8.4, -8.55 * 6), Vector3(segment.width * 3, 8.4, 0.16 * 6))

func _update_fixture_visibility(franchise: Dictionary) -> void:
	for node in parts["closed-checkouts"].nodes.values():
		var source_name: String = node.get_meta("source_name", "")
		if source_name.begins_with("closed-checkout:"):
			var lane := int(source_name.get_slice(":", 1))
			node.visible = not "purchase-campaign" in franchise.unlockedAreas and not CheckoutLayout.checkout_area_for_lane(lane) in franchise.unlockedAreas
	for part in [parts.furniture, parts.farm]:
		for entry in part.manifest.manifest:
			var candidate: Variant = part.nodes.get(entry.name)
			if not is_instance_valid(candidate): continue
			var node: Node3D = candidate
			if entry.sourceName == "production:professional-bakery": node.visible = FixtureAvailability.fixture_available("fixture:production-cubicle-shell", franchise.unlockedAreas)
			if entry.get("authored") == null: continue
			var authored: Dictionary = entry.authored
			var p: Array = authored.authoredPosition
			for fixture_id in ProductionLayout.STORE_PRODUCTION_FIXTURES:
				var fixture: Dictionary = ProductionLayout.STORE_PRODUCTION_FIXTURES[fixture_id]
				if _same_position(p, fixture.position): node.visible = FixtureAvailability.fixture_available(fixture.obstacleId, franchise.unlockedAreas)
			for department in RetailLayout.RETAIL_DEPARTMENT_IDS:
				var positions: Array = RetailLayout.PRODUCE_DISPLAY_POSITIONS if department == "produce" else (RetailLayout.PANTRY_DISPLAY_POSITIONS if department == "pantry" else [RetailLayout.RETAIL_DEPARTMENTS[department].display])
				for index in positions.size():
					if _same_position(p, positions[index]): node.visible = FixtureAvailability.fixture_available("fixture:retail-%s-%d" % [department, index + 1], franchise.unlockedAreas)
			for lane in [1, 2]:
				if _same_position(p, CheckoutLayout.CHECKOUT_LANES[lane].counter) or _same_position(p, CheckoutLayout.CHECKOUT_LANES[lane].cashierWork): node.visible = CheckoutLayout.checkout_area_for_lane(lane) in franchise.unlockedAreas
			for plot in FarmLayout.FARM_PLOTS:
				if _same_position(p, plot.position):
					var crop: Variant = Progression.find_id(franchise.crops, plot.id)
					node.visible = not "purchase-campaign" in franchise.unlockedAreas or (crop != null and crop.status != "LOCKED")
			for station_id in FarmLayout.FARM_ANIMAL_STATIONS:
				var station: Dictionary = FarmLayout.FARM_ANIMAL_STATIONS[station_id]
				if _same_position(p, station.position): node.visible = FixtureAvailability.fixture_available({"chicken": "fixture:chicken-coop", "chicken2": "fixture:chicken-coop-2", "cow": "fixture:cow-station"}[station_id], franchise.unlockedAreas)

static func _same_position(a: Array, b: Array) -> bool:
	return absf(a[0] - b[0]) < 0.0001 and absf(a[2] - b[2]) < 0.0001

func _exit_tree() -> void:
	crops.dispose()

## OrthographicCamera in MarketScene.tsx: size is the vertical frustum span.
func _update_camera(delta: float, checkout_focused: bool) -> void:
	checkout_camera_blend = lerpf(checkout_camera_blend, 1.0 if checkout_focused else 0.0, Locomotion.damp_factor(4.8 if checkout_focused else 3.2, delta))
	var focus := Vector3(player_body.position.x, 0.9 * 1.65 * 3, player_body.position.z)
	var checkout_target: Array = WorldScale.scale_store_position(CheckoutLayout.CHECKOUT_CAMERA_TARGET)
	var checkout_position: Array = WorldScale.scale_store_position(CheckoutLayout.CHECKOUT_CAMERA_POSITION)
	camera.position = (focus + Vector3(16, 23, 25.75) * 3).lerp(Vector3(checkout_position[0], checkout_position[1], checkout_position[2]) * 3, checkout_camera_blend)
	camera.look_at(focus.lerp(Vector3(checkout_target[0], checkout_target[1], checkout_target[2]) * 3, checkout_camera_blend))
	var viewport := get_viewport().get_visible_rect().size
	var overview_zoom := minf(viewport.x / 32, viewport.y / 28.5) / 1.15 * 1.3
	var checkout_zoom := minf(viewport.x / CheckoutLayout.CHECKOUT_CAMERA_FRAME.width, viewport.y / CheckoutLayout.CHECKOUT_CAMERA_FRAME.height) * 1.3
	camera_zoom = lerpf(camera_zoom, lerpf(overview_zoom, checkout_zoom, checkout_camera_blend), Locomotion.damp_factor(5, delta))
	camera.size = viewport.y / camera_zoom
