extends SceneTree
func _init() -> void: run.call_deferred()
func run() -> void:
	var store := MarketStore.new()
	root.add_child(store)
	store.game = MarketEngine.create_campaign_game()
	store.game.tutorialStep = 1
	var world := MarketWorld.new()
	world.store = store
	root.add_child(world)
	world.set_physics_process(false)
	world.player_body.position = Vector3(44.68348, 0, 31.16235)
	world.workstation.sync("checkout", 0)
	world.presentation_ready = true
	world.driveable = true
	var forward := Vector2(-16,-25.75).normalized()
	var right := Vector2(-forward.y, forward.x)
	for point: Vector2 in [Vector2(44.68348,32.13001), Vector2(40.80001,32.13001)]:
		for frame in 300:
			await physics_frame
			var current := Vector2(world.player_body.position.x, world.player_body.position.z)
			var offset := point-current
			if offset.length() < 0.2: break
			var magnitude := minf(1,offset.length()/3)
			var direction := offset.normalized()
			world.input.set_pointer({"x":direction.dot(right),"y":-direction.dot(forward),"magnitude":magnitude})
			world._physics_process(1.0/60)
			if frame % 60 == 0:
				print("EXIT ",point," current=",current," input=",world.input.sample()," work=",world.workstation.snapshot())
				for index in world.player_body.get_slide_collision_count():
					var collision := world.player_body.get_slide_collision(index)
					var body := collision.get_collider() as Node3D
					var shape := body.get_child(0) as CollisionShape3D
					print("HIT normal=",collision.get_normal()," at=",collision.get_position()," box=",shape.global_position," size=",shape.shape.size if shape.shape is BoxShape3D else "capsule")
	print("EXIT FINAL ",world.player_body.position)
	world.free()
	store.free()
	NavMeshService.dispose_store_navigation()
	quit()
