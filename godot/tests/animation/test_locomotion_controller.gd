extends TestCase

func _action(name: String, duration: float) -> LocomotionController.LocomotionAction:
	return LocomotionController.LocomotionAction.new(name, duration)

func test_aplica_histeresis_carga_y_giro_sobre_pies() -> void:
	var controller := LocomotionController.new()
	assert_eq(controller.select(0.1, 0.0, false), "Idle")
	assert_eq(controller.select(0.13, 0.0, false), "Walk")
	assert_eq(controller.select(0.08, 0.0, true), "CarryWalk")
	assert_eq(controller.select(0.06, PI, false), "TurnRight")

func test_conserva_la_fase_del_paso_al_pasar_de_marcha_libre_a_carga() -> void:
	var controller := LocomotionController.new()
	var walk := _action("Walk", 1.0)
	var carry_walk := _action("CarryWalk", 2.0)
	var actions := { "Walk": walk, "CarryWalk": carry_walk }
	controller.transition(actions, "Walk", 1.0)
	walk.time = 0.42
	controller.transition(actions, "CarryWalk", 1.1)
	assert_near(carry_walk.time / carry_walk.get_clip_duration(), 0.42, 0.005)
	assert_true(carry_walk.is_running())

func test_permite_una_pose_idle_inmovil_sin_reiniciar_la_accion_cada_frame() -> void:
	var controller := LocomotionController.new()
	var idle := _action("Idle", 2.0)
	controller.transition({ "Idle": idle }, "Idle", 0.0)
	controller.transition({ "Idle": idle }, "Idle", 0.0)
	assert_true(idle.is_scheduled())
	assert_eq(idle.get_effective_time_scale(), 0.0)
	assert_eq(idle.reset_count, 1)

func test_reactiva_el_clip_actual_si_un_cross_fade_lo_dejo_programado_con_peso_cero() -> void:
	var controller := LocomotionController.new()
	var idle := _action("Idle", 2.0)
	controller.transition({ "Idle": idle }, "Idle", 1.0)
	idle.enabled = false
	controller.transition({ "Idle": idle }, "Idle", 1.0)
	assert_true(idle.is_scheduled())
	assert_true(idle.is_running())
	assert_true(idle.enabled)
	assert_eq(idle.reset_count, 2)

func test_usa_histeresis_para_no_alternar_entre_marcha_y_carrera_cerca_del_umbral() -> void:
	var controller := LocomotionController.new()
	assert_eq(controller.select(3.2, 0.0, false), "Run")
	assert_eq(controller.select(2.9, 0.0, false), "Run")
	assert_eq(controller.select(2.7, 0.0, false), "Walk")

func test_mantiene_los_brazos_de_carga_al_correr_con_una_cesta() -> void:
	var controller := LocomotionController.new()
	assert_eq(controller.select(3.2, 0.0, true), "CarryRun")
	assert_eq(controller.select(2.9, 0.0, true), "CarryRun")
	assert_eq(controller.select(2.7, 0.0, true), "CarryWalk")

func test_escala_cada_clip_por_su_zancada_medida_para_que_los_pies_no_patinen() -> void:
	# Un cuerpo a escala 2 que avanza 1,4 u/s necesita Walk (0,35 u/s a escala 1) al doble.
	assert_near(LocomotionController.gait_time_scale("Walk", 1.4, 2.0), 2.0, 0.005)
	assert_near(LocomotionController.gait_time_scale("Run", 2.14, 2.0), 1.0, 0.005)
	assert_near(LocomotionController.gait_time_scale("BasketWalk", 2.6, 2.0), 2.5, 0.005)
	assert_eq(LocomotionController.gait_time_scale("Walk", 40.0, 2.0), 2.8)
	assert_eq(LocomotionController.gait_time_scale("Walk", 0.01, 2.0), 0.6)
	assert_null(LocomotionController.gait_time_scale("Browse", 1.0, 2.0))
	assert_false(LocomotionController.CLIP_NATURAL_SPEED.has("CarryBasket"))

func test_decide_correr_por_la_relacion_entre_velocidad_y_zancada_del_actor() -> void:
	var controller := LocomotionController.new()
	var walk_floor: float = LocomotionController.CLIP_NATURAL_SPEED.Walk * 2.0
	assert_eq(controller.select(walk_floor * (LocomotionController.RUN_GAIT_RATIO.start + 0.1), 0.0, false, walk_floor), "Run")
	assert_eq(controller.select(walk_floor * (LocomotionController.RUN_GAIT_RATIO.stop + 0.05), 0.0, false, walk_floor), "Run")
	assert_eq(controller.select(walk_floor * (LocomotionController.RUN_GAIT_RATIO.stop - 0.05), 0.0, false, walk_floor), "Walk")

func test_aplica_apoyo_completo_de_pies_durante_carryrun() -> void:
	assert_eq(LocomotionController.locomotion_grounding_support("CarryRun"), 1.0)
	assert_eq(LocomotionController.locomotion_grounding_support("CarryWalk"), 1.0)
	assert_eq(LocomotionController.locomotion_grounding_support("Idle"), 0.25)

func test_emite_apoyos_alternos_y_simetricos_en_la_fase_anatomica_del_paso() -> void:
	var controller := LocomotionController.new()
	var walk := _action("Walk", 1.0)
	controller.transition({ "Walk": walk }, "Walk", 1.0)
	walk.time = 0.13
	assert_eq(controller.foot_events(walk), ["LeftFootDown"])
	walk.time = 0.63
	assert_eq(controller.foot_events(walk), ["RightFootDown"])
	walk.time = 0.13
	assert_eq(controller.foot_events(walk), ["LeftFootDown"])
	assert_eq(LocomotionController.GAIT_FOOT_CONTACT_PHASES.right - LocomotionController.GAIT_FOOT_CONTACT_PHASES.left, 0.5)
