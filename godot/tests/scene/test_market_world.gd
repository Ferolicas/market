extends TestCase
const World = preload("res://game/scene/market_world.gd")
const Store = preload("res://game/store.gd")
const Game = preload("res://game/engine.gd")
const Shell = preload("res://game/ui/game_shell.gd")
var recovery_directory: String
var world: World
var store: Store

func before_each() -> void:
	store = Store.new()
	recovery_directory = "user://test-world-" + JS.uuid()
	store.recovery = RecoveryStorage.new()
	store.recovery.directory = recovery_directory
	store.add_child(store.recovery)
	Engine.get_main_loop().root.add_child(store)
	store.game = Game.create_campaign_game()
	store.game.tutorialStep = 1
	world = World.new()
	world.store = store
	Engine.get_main_loop().root.add_child(world)

func after_each() -> void:
	world.free()
	store.free()
	NavMeshService.dispose_store_navigation()
	var directory := DirAccess.open(recovery_directory)
	if directory != null:
		for file in directory.get_files(): directory.remove(file)
		DirAccess.remove_absolute(recovery_directory)

## Backs the startup-world-load telemetry report (application.gd) used to
## find the real cause of the loading-curtain freeze from device data,
## without needing Xcode Instruments or the Godot editor's remote profiler.
func test_ready_records_a_load_time_per_authored_part_for_telemetry() -> void:
	for part in ["ground", "city", "building", "furniture", "farm", "closed_checkouts", "rear_door", "doors", "inventory_bind", "crops_bind", "production_bind", "checkout_bind", "environment_setup", "sync_state", "total"]:
		assert_true(world.load_timings_ms.has(part + "_ms"), part)
		assert_gte(world.load_timings_ms[part + "_ms"], 0)
	assert_gte(world.load_timings_ms.total_ms, world.load_timings_ms.furniture_ms)
	# sync_state_ms became the dominant remaining startup cost (2523 of
	# 3304 ms) after the crops_bind_ms fix; the first sync_state() call is
	# broken down phase by phase to find what inside it actually costs that.
	for phase in ["configureAvatarMs", "buildCollisionsMs", "updateFixtureVisibilityMs", "interactionDirectorMs", "refreshVisualInventoryMs", "productionUpdateMs", "checkoutUpdateMs", "syncActorsMs"]:
		assert_true(world.load_timings_ms.has(phase), phase)
		assert_gte(world.load_timings_ms[phase], 0)

## Two customers sharing an identity must reuse the same finished material
## (the fix for the actorCreationMaxMs hitch — see character_presentation.gd),
## but two employees must keep fully independent materials, since
## configure_avatar mutates their albedo per instance; sharing there would
## make every employee sharing a body GLB flash the last-configured colors.
func test_customers_share_a_finish_but_employees_never_do() -> void:
	var first_customer := MarketActor.new()
	var second_customer := MarketActor.new()
	world.add_child(first_customer)
	world.add_child(second_customer)
	first_customer.configure_customer(1)
	second_customer.configure_customer(1)
	var first_customer_material: Material = first_customer.model.find_children("*", "MeshInstance3D", true, false)[0].get_surface_override_material(0)
	var second_customer_material: Material = second_customer.model.find_children("*", "MeshInstance3D", true, false)[0].get_surface_override_material(0)
	assert_true(is_same(first_customer_material, second_customer_material))
	var first_employee := MarketActor.new()
	var second_employee := MarketActor.new()
	world.add_child(first_employee)
	world.add_child(second_employee)
	first_employee.configure_avatar({"body": "adult-man", "hair": "fade", "skin": "#ff0000", "shirt": "#00ff00", "hairColor": "#3b2820", "hat": "none"})
	second_employee.configure_avatar({"body": "adult-man", "hair": "fade", "skin": "#0000ff", "shirt": "#ffff00", "hairColor": "#3b2820", "hat": "none"})
	var body_material_of: Callable = func(actor: MarketActor): return actor.model.find_children("*", "MeshInstance3D", true, false)[0].get_surface_override_material(0)
	# configure_avatar mutates whichever surface materials happen to carry the
	# "skin"/"shirt"/hair naming (asset-dependent, may be a no-op on the
	# current combined-atlas body GLB); the guarantee that must hold
	# regardless of the current art is that two employees never end up on the
	# very same material instance, so a future per-instance mutation can never
	# bleed from one onto the other the way it would for shared customers.
	assert_false(is_same(body_material_of.call(first_employee), body_material_of.call(second_employee)))
	first_customer.free()
	second_customer.free()
	first_employee.free()
	second_employee.free()

## Backs the rig*MaxMs fields folded into client_telemetry's one-minute-window
## report — caching the finished material (test above) did not move
## actorCreationMaxMs on the next real device sample, so _load_rig() is timed
## phase by phase to find where the real cost actually is.
func test_load_rig_records_a_max_time_per_phase_for_telemetry() -> void:
	MarketActor.take_rig_phase_stats() # drain anything left over from other tests
	var actor := MarketActor.new()
	world.add_child(actor)
	actor.configure_customer(2)
	var stats := MarketActor.take_rig_phase_stats()
	for phase in ["rigInstantiateMaxMs", "rigPrepareModelMaxMs", "rigSkeletonScanMaxMs", "rigAnimationSetupMaxMs"]:
		assert_true(stats.has(phase), phase)
		assert_gte(stats[phase], 0)
	assert_eq(MarketActor.take_rig_phase_stats(), {}, "Stats drain on read")
	actor.free()

func test_scene_loads_native_physics_original_rig_and_initial_campaign() -> void:
	assert_eq(world.player_body.position, Vector3(0, 0, 37.5))
	assert_gt(world.static_bodies.get_child_count(), 10)
	assert_true(world.player_actor.player.has_animation("Idle"))
	assert_gt(world.parts.furniture.labels.size(), 50)
	assert_gt(world.director._zones.size(), 0)
	world._physics_process(1.0 / 60)
	world._process(1.0 / 60)
	assert_true(world.camera.current)

func test_world_tick_creates_customers_with_original_models_and_animations() -> void:
	store.game = Game.create_initial_game()
	store.game.tutorialStep = 1
	store.game.franchises[0].open = true
	assert_eq(world.take_actor_creation_stats().actorCreationCount, 0)
	store.tick_world(200)
	assert_gt(world.actors.size(), 0)
	for actor in world.actors.values():
		assert_not_null(actor.player)
		assert_gt(actor.clips.size(), 10)
	world._process(0.016)
	# Backs the actorCreationMaxMs field folded into client_telemetry's
	# one-minute-window report, testing whether a new customer's first-frame
	# GLB load + material setup is the source of the reported mid-play hitches.
	var stats := world.take_actor_creation_stats()
	assert_gt(stats.actorCreationCount, 0)
	assert_lte(stats.actorCreationCount, world.actors.size())
	assert_gte(stats.actorCreationMaxMs, 0)
	assert_eq(world.take_actor_creation_stats().actorCreationCount, 0, "Stats drain on read")

func test_management_panels_use_the_live_store_without_parse_errors() -> void:
	var shell := Shell.new()
	shell.store = store
	shell.world = world
	Engine.get_main_loop().root.add_child(shell)
	for panel in ["stock", "orders", "team", "map", "finance", "avatar", "help", "settings"]:
		shell.open_panel(panel)
		assert_eq(shell.panel, panel)
		assert_false(world.driveable)
		shell.close_panel()
		assert_true(world.driveable)
	shell.free()

func test_harvest_and_stock_update_real_carry_canopy_and_display_meshes() -> void:
	var plot: Dictionary = world.crops.plots["crop-tomato-1"]
	assert_eq(plot.key, "crop:tomato:0")
	var franchise := EngineProgression.current_franchise(store.game)
	var crop: Dictionary = EngineProgression.find_id(franchise.crops, "crop-tomato-1")
	var deadline: float = crop.readyAt
	while store.game.simulationTimeMs < deadline:
		store.tick_world(minf(1000, deadline - store.game.simulationTimeMs))
	assert_eq(plot.key, "crop:tomato:READY")
	assert_gt(plot.fruits.size(), 0)
	assert_true(plot.glow.visible)
	world._interact(FarmLayout.farm_interaction_id("crop-tomato-1"))
	store.tick_world(200)
	franchise = EngineProgression.current_franchise(store.game)
	var harvested := CarrySystem.carry_quantity(franchise.carry, "tomatoes")
	assert_gt(harvested, 0)
	assert_false(world.player_actor.carrying, "Harvested units remain in flight before reaching the basket")
	assert_eq(CarrySystem.carry_total(world.visual_franchise(franchise).carry), 0)
	assert_gt(world.transfers.entries.size(), 0)
	for frame in 120: world.transfers.advance(1.0 / 60)
	assert_eq(world.transfers.entries.size(), 0)
	assert_true(world.player_actor.carrying)
	assert_not_null(world.player_actor.basket)
	assert_eq(world.player_actor.basket.container.get_child_count(), harvested)
	world.player_actor._process(0.016)
	world.player_actor.player.advance(0.016)
	world.player_actor._update_carry_pose()
	assert_true(world.player_actor.basket.position.is_finite())
	var remaining: Dictionary = EngineProgression.find_id(franchise.crops, "crop-tomato-1")
	if remaining.status == "READY":
		var expected_slots := CropVisual.crop_visual_slot_indices(remaining.available, StationSystem.crop_harvest_yield(remaining.productId, remaining.tier, remaining.get("baseYield")), plot.fruits.size())
		assert_eq(plot.fruits.filter(func(fruit): return fruit.visible).size(), expected_slots.size())
		assert_lt(expected_slots.size(), plot.fruits.size())
	else: assert_ne(plot.key, "crop:tomato:READY")
	world._interact(RetailLayout.stocking_interaction_id("produce"))
	store.tick_world(200)
	franchise = EngineProgression.current_franchise(store.game)
	assert_gt(franchise.shelves.tomatoes, 0)
	assert_eq(franchise.shelves.tomatoes + CarrySystem.carry_quantity(franchise.carry, "tomatoes"), harvested)
	assert_eq(world.visual_franchise(franchise).shelves.tomatoes, 0, "Stock remains in flight until landing")
	for frame in 120: world.transfers.advance(1.0 / 60)
	assert_eq(world.transfers.entries.size(), 0)
	var visible_count := 0
	for group in world.inventory.groups.tomatoes:
		if not group.node.is_visible_in_tree(): continue
		assert_gt(group.batches.size(), 0)
		visible_count += group.batches[0].node.multimesh.instance_count
	assert_eq(visible_count, franchise.shelves.tomatoes)

func test_first_sale_real_customer_checkout_register_and_purchase_contribution() -> void:
	var franchise := EngineProgression.current_franchise(store.game)
	var crop: Dictionary = EngineProgression.find_id(franchise.crops, "crop-tomato-1")
	var deadline: float = crop.readyAt
	while store.game.simulationTimeMs < deadline: store.tick_world(minf(1000, deadline - store.game.simulationTimeMs))
	world._interact(FarmLayout.farm_interaction_id("crop-tomato-1"))
	store.tick_world(200)
	for unit in 3:
		world._interact(RetailLayout.stocking_interaction_id("produce"))
		store.tick_world(450)
	assert_true(store.dispatch({"type": "TOGGLE_STORE"}).ok)
	for step in 1200:
		world._interact("checkout")
		store.tick_world(450)
		franchise = EngineProgression.current_franchise(store.game)
		if franchise.customersToday > 0: break
	assert_gt(franchise.customersToday, 0, "Actual customer navigation and checkout must reach payment")
	assert_gt(franchise.registerCashMinor[0], 0)
	var balance_before: float = store.game.balanceMinor
	world._interact("register-0")
	store.tick_world(450)
	assert_gt(store.game.balanceMinor, balance_before)
	world._interact(PurchaseLayout.purchase_interaction_id("farmer-1"))
	store.tick_world(450)
	var quote: Dictionary = Game.campaign_purchase_quotes(store.game).filter(func(item): return item.id == "farmer-1")[0]
	assert_gt(quote.contributedMinor, 0)

func test_rear_farm_door_visual_and_physical_leaves_follow_occupancy() -> void:
	var rear: Dictionary = StorefrontLayout.STORE_REAR_DOOR
	world.player_body.position = Vector3(rear.x * 6, 0, rear.z * 6)
	for frame in 24: world._process(1.0 / 60)
	assert_eq(world.rear_door_motion.progress, 1)
	for index in 2:
		var center := StorefrontLayout.rear_door_leaf_center(-1 if index == 0 else 1, 1)
		assert_near(world.rear_door_leaves[index].position.x, center * 6)
		assert_near(world.rear_door_visual.get_child(index).global_position.x, center * 6, 0.00001) # Godot spatial transforms use float32.
	world.player_body.position = Vector3.ZERO
	for frame in 80: world._process(1.0 / 60)
	assert_eq(world.rear_door_motion.progress, 0)

func test_legacy_management_and_live_inventory_refresh() -> void:
	store.game = Game.create_initial_game()
	store.game.tutorialStep = 1
	world.sync_state()
	var shell := Shell.new()
	shell.store = store
	shell.world = world
	Engine.get_main_loop().root.add_child(shell)
	for panel in ["stock", "orders", "team", "map", "finance"]:
		shell.open_panel(panel)
		assert_false(shell._panel_state_key().is_empty())
		shell._refresh_panel()
	shell.free()

func test_initial_avatar_changes_are_staged_until_setup_completion() -> void:
	store.game.tutorialStep = 0
	var original: Dictionary = store.game.avatar.duplicate(true)
	var shell := Shell.new()
	shell.store = store
	shell.world = world
	Engine.get_main_loop().root.add_child(shell)
	assert_eq(shell.panel, "setup")
	shell._change_avatar({"hairColor": "#ff0000", "hair": "waves", "hat": "none"})
	assert_eq(store.game.avatar, original)
	assert_eq(shell.setup_avatar.hairColor, "#ff0000")
	shell.free()

func test_cart_tracks_real_rig_parking_inventory_and_loaded_units() -> void:
	store.game = Game.create_initial_game()
	store.game.tutorialStep = 1
	store.game.franchises[0].open = true
	store.tick_world(200)
	var customer: Dictionary = store.game.franchises[0].customers[0]
	var actor: MarketActor = world.actors[customer.id]
	customer.hasCart = true
	customer.state = "NAVIGATE_TO_PRODUCT"
	customer.basket = {"tomatoes": 3, "oranges": 2}
	world._process(0.016)
	actor._process(0.016)
	assert_true(actor.cart.visible)
	assert_eq(actor.cart.contents.get_child_count(), 4 if actor.model_tier > 0 else 5)
	assert_true(actor.cart.chassis.global_position.is_finite())
	assert_eq(actor.cart.casters.get_child_count(), 4)
	assert_eq(actor.cart.wheels.get_child_count(), 4)
	var transaction := {"state": "CUSTOMER_LOADING", "pendingItems": [{"productId": "tomatoes", "quantity": 3, "loaded": 2}, {"productId": "oranges", "quantity": 2, "loaded": 0}]}
	actor.cart.update_inventory(customer, transaction, false)
	assert_eq(actor.cart.contents.get_child_count(), 3)
	customer.state = "WAIT_CHECKOUT"
	customer.queueLane = 0
	customer.queueSlot = 0
	for frame in 60: actor.cart.animate(actor, customer, null, 1.0 / 60)
	var parked: Array = CheckoutLayout.checkout_parked_cart(customer)
	var expected: Vector3 = actor.get_parent().to_global(Vector3(parked[0] * 2, 0, parked[1] * 2))
	assert_near(actor.cart.chassis.global_position.distance_to(expected), 0, 0.001)
	customer.hasBag = true
	actor.cart.update_inventory(customer, transaction, false)
	assert_true(actor.cart.bag.visible)

func test_keyboard_motion_preserves_original_world_scaled_speed() -> void:
	var event := InputEventKey.new()
	event.physical_keycode = KEY_LEFT
	event.pressed = true
	Input.parse_input_event(event)
	Input.flush_buffered_events()
	for frame in 60: world._physics_process(1.0 / 60)
	var expected_speed: float = PlayerController.player_motion_for_tier(1, true).walkSpeed * WorldScale.WORLD_SCALE
	assert_near(world.motion_velocity.length(), expected_speed, 0.00001)
	event = event.duplicate()
	event.pressed = false
	Input.parse_input_event(event)
	Input.flush_buffered_events()
	for frame in 60: world._physics_process(1.0 / 60)
	assert_eq(world.motion_velocity, Vector2.ZERO)

func test_production_boards_outputs_and_animal_feed_follow_machine_state() -> void:
	var franchise := EngineProgression.current_franchise(store.game)
	assert_eq(world.production.machines.size(), 5)
	assert_eq(world.production.animals.size(), 3)
	for id in world.production.machines:
		var machine: Variant = EngineProgression.find_id(franchise.productionMachines, id)
		if machine == null:
			machine = StationSystem.create_machine(id, "cannedCorn")
			franchise.productionMachines.append(machine)
		machine.status = "PROCESSING"
		world.production.update(franchise)
		var view: Dictionary = world.production.machines[id]
		assert_eq(view.labels[4].text, "EN PROCESO")
		if view.light != null: assert_true(view.light.visible)
		machine.status = "OUTPUT_READY"
		machine.output = 5
		world.production.update(franchise)
		assert_eq(view.labels[4].text, "RECOGER")
		assert_eq(view.labels[1].text, "5/%s" % machine.outputCapacity)
		if view.output != null: assert_eq(view.output.get_child_count(), 4)
		if view.light != null: assert_false(view.light.visible)
	for id in world.production.animals:
		var machine: Variant = EngineProgression.find_id(franchise.productionMachines, id)
		if machine == null:
			machine = StationSystem.create_machine(id, "eggs")
			franchise.productionMachines.append(machine)
		machine.output = 2
		world.production.update(franchise)
		var view: Dictionary = world.production.animals[id]
		assert_true(view.output.visible)
		assert_eq(view.labels[4].text, "2/%s" % machine.outputCapacity)
		machine.output = 0
		world.production.update(franchise)
		assert_false(view.output.visible)

func test_checkout_conveyor_bags_handoff_and_service_fixtures() -> void:
	var franchise := EngineProgression.current_franchise(store.game)
	assert_eq(world.checkout.lanes.size(), 3)
	assert_eq(world.checkout.carts.size(), 4)
	assert_eq(world.checkout.dairy_doors.size(), 3)
	var transaction := {"id": "visual-checkout", "customerId": "visual-customer", "checkoutLane": 0, "state": "SCANNING", "updatedAt": 1, "pendingItems": [{"productId": "tomatoes", "quantity": 3, "loaded": 2, "scanned": 1, "bagged": 0}]}
	franchise.checkoutTransactions = [transaction]
	world.checkout.update(franchise)
	var lane: Dictionary = world.checkout.lanes[0]
	assert_eq(lane.label.text, "0/3")
	assert_eq(lane.units.size(), 2)
	assert_true(lane.scan_light.visible)
	assert_true(lane.bags[0].visible)
	assert_false(lane.bags[1].visible)
	for frame in 120: world.checkout.animate(1.0 / 60)
	assert_near(lane.units["tomatoes-0"].node.position.distance_to(Vector3(1.48, 1.38, 0.18)), 0, 0.0001)
	transaction.pendingItems[0].bagged = 1
	world.checkout.update(franchise)
	assert_eq(lane.units.size(), 1)
	assert_eq(lane.label.text, "1/3")
	transaction.state = "COMPLETE"
	transaction.pendingItems[0].bagged = 3
	franchise.customers = [{"id": "visual-customer", "transactionId": transaction.id, "state": "NAVIGATE_TO_BAG", "shoppingList": [], "currentLine": 0}]
	world.checkout.update(franchise)
	assert_eq(lane.units.size(), 0)
	assert_true(lane.bags[0].visible, "Paid bag remains on the counter until handoff")
	franchise.customers[0].state = "TAKE_BAG"
	world.checkout.update(franchise)
	assert_false(lane.bags[0].visible, "Bag now belongs to the customer's hand")
	franchise.returnedCartCount = 4
	franchise.returnsBin = {"tomatoes": 4, "oranges": 4}
	franchise.customers[0].state = "PICK_PRODUCT"
	franchise.customers[0].shoppingList = [{"productId": "milk"}]
	world.checkout.update(franchise)
	assert_eq(world.checkout.carts.filter(func(cart): return cart.visible).size(), 4)
	assert_eq(world.checkout.returns_contents.get_child_count(), 6)
	for frame in 120: world.checkout.animate(1.0 / 60)
	assert_near(world.checkout.dairy_doors[0].rotation.y, -1.05, 0.0001)

func test_employee_updates_hat_and_faces_checkout_while_waiting() -> void:
	var franchise := EngineProgression.current_franchise(store.game)
	var employee := {"id": "cashier-presentation", "role": "cashier", "hat": "none", "runtime": {"state": "WAIT_CHECKOUT_STATION", "x": 15.0, "z": 7.0, "targetX": 15.0, "targetZ": 7.0, "path": [], "pathIndex": 0, "speed": 2.0, "carry": {"capacity": 3, "items": {}}}}
	franchise.employees.append(employee)
	world._sync_actors(franchise)
	var actor: MarketActor = world.actors[employee.id]
	var original_model := actor.model
	employee.hat = "frog"
	world._sync_actors(franchise)
	assert_ne(actor.model, original_model)
	assert_contains(actor.appearance, "frog")
	actor.rotation.y = 0.0
	world._process(0.05)
	assert_near(absf(actor.rotation.y), 3.5 * 0.05)
	employee.runtime.state = "IDLE"
	world._sync_actors(franchise)
	var waiting_heading := actor.rotation.y
	world._process(0.05)
	assert_near(actor.rotation.y, waiting_heading)

func test_pointer_release_focus_loss_and_panel_clear_movement() -> void:
	for pointer in [-1, 3]:
		world.joystick.begin(pointer, 100, 100, 1280, 720)
		world.input.set_pointer(InputManager.normalized_input(1, 0))
		var event: InputEvent
		if pointer == -1:
			event = InputEventMouseButton.new()
			event.button_index = MOUSE_BUTTON_LEFT
		else:
			event = InputEventScreenTouch.new()
			event.index = pointer
		event.pressed = false
		# _input runs even when the HUD consumes the event before _unhandled_input.
		world._input(event)
		assert_eq(world.input.sample().magnitude, 0)
		assert_null(world.joystick.pointer_id)
	world.input.set_gamepad(1, 1)
	world.input.set_keyboard(1, 0)
	world._notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
	assert_eq(world.input.sample().magnitude, 0)
	world.joystick.begin(5, 100, 100, 1280, 720)
	world.input.set_pointer(InputManager.normalized_input(1, 0))
	world.driveable = false
	assert_eq(world.input.sample().magnitude, 0)
	assert_null(world.joystick.pointer_id)

func test_purchase_celebration_dismisses_without_replay_and_resets_on_travel() -> void:
	var shell := Shell.new()
	shell.store = store
	shell.world = world
	Engine.get_main_loop().root.add_child(shell)
	assert_false(shell.celebration.visible)
	var franchise := EngineProgression.current_franchise(store.game)
	var definition: Dictionary = MartCampaign.OPENING_PURCHASES[0]
	# The shell observes authoritative snapshots, irrespective of input source.
	franchise.purchases.purchased.append(definition.id)
	shell.refresh()
	assert_true(shell.celebration.visible)
	assert_eq(shell.celebration.purchase_label, definition.label)
	shell.celebration._process(2.99)
	assert_true(shell.celebration.visible)
	shell.refresh()
	shell.celebration._process(0.02)
	assert_false(shell.celebration.visible)
	shell.refresh()
	assert_false(shell.celebration.visible)
	shell.celebration.show_purchase(definition.label)
	store.game.currentFranchiseId = store.game.franchises[1].id
	shell.refresh()
	assert_false(shell.celebration.visible)
	shell.free()

func test_level_hint_highlights_next_available_purchase_for_nine_seconds() -> void:
	assert_eq(world.cash_markers.highlighted, "")
	var franchise := EngineProgression.current_franchise(store.game)
	franchise.purchases.purchased.append(MartCampaign.OPENING_PURCHASES[0].id)
	world.cash_markers.update(store.game)
	var available := Game.campaign_purchase_quotes(store.game).filter(func(quote): return quote.available)
	assert_gt(available.size(), 0)
	assert_false(world.cash_markers.highlighted.is_empty())
	assert_true(available.any(func(quote): return quote.id == world.cash_markers.highlighted))
	world.cash_markers._process(8.99)
	world.cash_markers.update(store.game)
	assert_false(world.cash_markers.highlighted.is_empty())
	world.cash_markers._process(0.02)
	assert_eq(world.cash_markers.highlighted, "")
	world.cash_markers.update(store.game)
	assert_eq(world.cash_markers.highlighted, "")

func test_customer_pickup_flies_from_shelf_to_actual_cart_socket() -> void:
	store.game = Game.create_initial_game()
	store.game.tutorialStep = 1
	store.game.franchises[0].open = true
	store.tick_world(200)
	var customer: Dictionary = store.game.franchises[0].customers[0]
	var actor: MarketActor = world.actors[customer.id]
	customer.hasCart = true
	customer.state = "PICK_PRODUCT"
	customer.shoppingList = [{"productId": "tomatoes", "quantity": 1, "picked": 0}]
	customer.currentLine = 0
	actor._process(0.016)
	assert_true(actor.pickup_visual.visible)
	assert_eq(actor.pickup_product, "tomatoes")
	assert_near(actor.pickup_visual.get_child(0).scale.x, 1.35)
	var source := actor.pickup_visual.global_position
	assert_near(source.y, 0.86 * 1.6 * 3, 0.00001)
	for frame in 34: actor._process(1.0 / 60)
	assert_near(actor.pickup_visual.global_position.distance_to(actor.cart.basket.global_position), 0, 0.00001)
	assert_gt(source.distance_to(actor.pickup_visual.global_position), 0.1)
	customer.state = "NAVIGATE_TO_QUEUE"
	actor._process(0.016)
	assert_false(actor.pickup_visual.visible)

func test_lighting_updates_original_materials_and_respects_mobile_ceiling_policy() -> void:
	var franchise := EngineProgression.current_franchise(store.game)
	franchise.open = true
	franchise.lightsOn = true
	world.checkout.dynamic_ceiling_lights = true
	world.sync_state()
	assert_eq(world.front_door_indicator.albedo_color, Color("72e8a9"))
	for light in world.checkout.ceiling_lights:
		assert_true(light.visible)
		assert_near(light.light_energy * PI, 0.18)
		assert_eq(light.omni_range, 4.0)
	world.checkout.dynamic_ceiling_lights = false
	world.checkout.update(franchise)
	for light in world.checkout.ceiling_lights: assert_false(light.visible)

func test_render_runtime_waits_for_stable_scene_and_grace_before_adapting() -> void:
	var runtime := world.rendering
	runtime.profile = AdaptiveQuality.market_render_profile_for_capabilities({"width": 390, "coarsePointer": true, "devicePixelRatio": 3})
	runtime.dpr = 2.0
	for frame in 30: runtime.advance_frame(40, false, 100)
	assert_eq(runtime.phase, "compiled")
	assert_false(runtime.scene_settled)
	for frame in 29: runtime.advance_frame(16, false, 100)
	assert_false(runtime.scene_settled)
	runtime.advance_frame(16, false, 100)
	assert_true(runtime.scene_settled)
	for frame in 25: runtime.advance_frame(100, false, 100)
	assert_eq(runtime.dpr, 2.0)
	for frame in 5: runtime.advance_frame(100, false, 100)
	assert_near(runtime.dpr, 1.72)
	assert_lt(world.get_viewport().scaling_3d_scale, 2.0)

func test_avatar_gallery_requests_actual_bodies_and_hair_and_buttons_clear_hat() -> void:
	var shell := Shell.new()
	shell.store = store
	shell.world = world
	Engine.get_main_loop().root.add_child(shell)
	shell.open_panel("avatar")
	assert_eq(shell.avatar_gallery.requests.size(), Catalog.CHARACTERS.size() + Catalog.HAIRSTYLES.size())
	shell._change_avatar({"hat": "owl"})
	for choice in shell.avatar_choices:
		if choice.key == "hair" and choice.id == Catalog.HAIRSTYLES[1].id:
			choice.button.pressed.emit()
			assert_true(choice.button.button_pressed)
	assert_eq(store.game.avatar.hair, Catalog.HAIRSTYLES[1].id)
	assert_eq(store.game.avatar.hat, "none")
	shell.close_panel()
	shell.free()

func test_glass_pass_shares_world_camera_and_linear_hdr_mips_without_ui() -> void:
	world.rendering.profile.glassTransmission = true
	world._process(1.0 / 60)
	world.transmission._process(0)
	var levels := world.transmission.levels
	assert_eq(levels.size(), 3)
	assert_eq(levels[0].world_3d, world.get_world_3d())
	assert_eq(world.transmission.camera.global_transform, world.camera.global_transform)
	assert_eq(world.transmission.camera.cull_mask, 2)
	assert_eq(world.camera.cull_mask, 1)
	for index in levels.size():
		assert_true(levels[index].use_hdr_2d)
		assert_eq(levels[index].render_target_update_mode, SubViewport.UPDATE_ALWAYS)
		assert_eq(levels[index].size.x, maxi(1, levels[0].size.x >> index))
	world.rendering.profile.glassTransmission = false
	world.transmission._process(0)
	for viewport in levels: assert_eq(viewport.render_target_update_mode, SubViewport.UPDATE_DISABLED)

func test_team_and_warehouse_buttons_apply_original_actions_and_refresh_limits() -> void:
	store.game.balanceMinor = 100000
	var franchise := EngineProgression.current_franchise(store.game)
	franchise.warehouse.tomatoes = 5
	var shell := Shell.new()
	shell.store = store
	shell.world = world
	Engine.get_main_loop().root.add_child(shell)
	shell.open_panel("team")
	var tier: int = franchise.playerSpeedTier
	var cost: int = RosterUpgrades.roster_entries(franchise, Game.country_money_scale(store.game.countryCode))[0].nextCostMinor
	var upgrade: Button
	for button in shell.find_children("*", "Button", true, false):
		if button.tooltip_text == "Mejora 1 de Tú, el fundador": upgrade = button
	assert_not_null(upgrade)
	assert_false(upgrade.disabled)
	upgrade.pressed.emit()
	franchise = EngineProgression.current_franchise(store.game)
	assert_eq(franchise.playerSpeedTier, tier + 1)
	assert_eq(store.game.balanceMinor, 100000 - cost)
	shell.open_panel("orders")
	var capacity: int = franchise.carry.capacity
	var pickup: Button
	for button in shell.find_children("*", "Button", true, false):
		if button.text == "Tomates · 5 en almacén": pickup = button
	assert_not_null(pickup)
	pickup.pressed.emit()
	franchise = EngineProgression.current_franchise(store.game)
	assert_eq(CarrySystem.carry_quantity(franchise.carry, "tomatoes"), mini(5, capacity))
	assert_eq(franchise.warehouse.tomatoes, maxi(0, 5 - capacity))
	shell.free()

func test_onboarding_country_selection_is_local_until_confirmation() -> void:
	store.game.tutorialStep = 0
	var original_country: String = store.game.countryCode
	var shell := Shell.new()
	shell.store = store
	shell.world = world
	Engine.get_main_loop().root.add_child(shell)
	assert_eq(shell.panel, "setup")
	for code in Catalog.COUNTRIES:
		var button: Button = shell.find_child("Country" + code, true, false)
		assert_not_null(button)
		assert_not_null(button.icon)
		button.pressed.emit()
		assert_eq(shell.setup_country, code)
		assert_eq(store.game.countryCode, original_country)
		assert_eq(store.game.tutorialStep, 0)
	shell.free()

func test_legacy_locked_checkout_uses_original_closed_model_until_unlock() -> void:
	store.game = Game.create_initial_game()
	var franchise := EngineProgression.current_franchise(store.game)
	franchise.unlockedAreas.erase("checkout-2")
	franchise.unlockedAreas.erase("checkout-3")
	world.sync_state()
	for lane in [1, 2]:
		var closed: Node3D
		for node in world.parts["closed-checkouts"].nodes.values():
			if node.get_meta("source_name", "") == "closed-checkout:%d" % lane: closed = node
		assert_not_null(closed, "Original closed-checkout geometry was exported")
		assert_true(closed.visible)
		for entry in world.parts.furniture.manifest.manifest:
			if entry.get("authored") == null: continue
			var position: Array = entry.authored.authoredPosition
			if World._same_position(position, CheckoutLayout.CHECKOUT_LANES[lane].counter) or World._same_position(position, CheckoutLayout.CHECKOUT_LANES[lane].cashierWork):
				assert_false(world.parts.furniture.nodes[entry.name].visible, "Full checkout and cashier floor stay hidden until unlocked")
		franchise.unlockedAreas.append(CheckoutLayout.checkout_area_for_lane(lane))
		world.sync_state()
		assert_false(closed.visible)
	store.game = Game.create_campaign_game()
	world.sync_state()
	for node in world.parts["closed-checkouts"].nodes.values():
		if str(node.get_meta("source_name", "")).begins_with("closed-checkout:"): assert_false(node.visible, "Campaign retains empty purchase areas")

func test_high_density_3d_scale_uses_backing_pixels_independently_of_ui_units() -> void:
	var window: Window = Engine.get_main_loop().root
	var previous_mode := window.content_scale_mode
	var previous_size := window.content_scale_size
	var physical := Vector2(window.size)
	window.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
	window.content_scale_size = Vector2i(physical / 2)
	for frame in 3: await Engine.get_main_loop().process_frame
	world.rendering.capabilities.width = physical.x / 2
	world.rendering.dpr = 1.5
	world.rendering._apply_resolution()
	assert_near(window.get_visible_rect().size.x, physical.x / 2, 1)
	assert_near(window.scaling_3d_scale, 0.75, 0.0001, "DPR 1.5 on density 2 must not double the 3D resolution")
	window.content_scale_size = previous_size
	window.content_scale_mode = previous_mode
	world.rendering.refresh_profile()

func test_portrait_camera_projection_matches_actual_three_callback() -> void:
	var cases: Array = JSON.parse_string(FileAccess.get_file_as_bytes("res://tests/fixtures/camera-oracle.json.gz").decompress_dynamic(8 * 1024 * 1024, FileAccess.COMPRESSION_GZIP).get_string_from_utf8())
	var viewport := SubViewport.new()
	viewport.own_world_3d = true
	Engine.get_main_loop().root.add_child(viewport)
	world.reparent(viewport)
	world.set_process(false)
	world.set_physics_process(false)
	var max_error := 0.0
	for fixture in cases:
		viewport.size = Vector2i(fixture.width, fixture.height)
		world.camera_zoom = 1.0
		world.checkout_camera_blend = 0.0
		for frame in fixture.frames:
			world.player_body.position = Vector3(frame.focus[0], frame.focus[1], frame.focus[2])
			world._update_camera(frame.delta, frame.checkoutFocused)
			assert_near(world.camera.near, frame.near)
			assert_near(world.camera.far, frame.far)
			assert_near(world.camera_zoom, frame.zoom, 0.0001)
			assert_lt(world.camera.position.distance_to(Vector3(frame.position[0], frame.position[1], frame.position[2])), 0.0001)
			for index in fixture.points.size():
				var point: Array = fixture.points[index]
				var projected := world.camera.unproject_position(Vector3(point[0], point[1], point[2]))
				var expected := Vector2(frame.projected[index][0], frame.projected[index][1])
				max_error = maxf(max_error, projected.distance_to(expected))
	assert_lt(max_error, 0.01, "Three/Godot landmark projection mismatch in logical pixels")
	print("Portrait camera oracle maximum error: ", max_error, " logical pixels")
	world.reparent(Engine.get_main_loop().root)
	viewport.free()
