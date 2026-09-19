extends TestCase
## Port of src/game/interaction/WorkstationController.test.ts

func test_stops_the_held_approach_input_until_it_returns_to_neutral() -> void:
	var controller := WorkstationController.new()
	controller.sync("farm", 1)

	assert_true(controller.update_input(1))
	var snapshot := controller.snapshot()
	assert_eq(snapshot.zoneId, "farm")
	assert_eq(snapshot.locked, true)
	assert_eq(snapshot.waitingForNeutral, true)
	assert_true(controller.update_input(0))
	assert_false(controller.snapshot().waitingForNeutral)

func test_uses_a_new_deliberate_input_to_leave_without_triggering_more_work() -> void:
	var controller := WorkstationController.new()
	controller.sync("shelf", 0)

	assert_true(controller.can_perform("shelf"))
	assert_false(controller.update_input(0.7))
	assert_false(controller.can_perform("shelf"))
	var snapshot := controller.snapshot()
	assert_eq(snapshot.locked, false)
	assert_eq(snapshot.cancelledUntilExit, true)

func test_rearms_only_after_leaving_the_previous_rectangle() -> void:
	var controller := WorkstationController.new()
	controller.sync("farm", 0)
	controller.update_input(1)
	controller.sync("farm", 0)
	assert_false(controller.can_perform("farm"))

	controller.sync(null, 0)
	controller.sync("farm", 0)
	assert_true(controller.can_perform("farm"))
