extends TestCase
const Bursts = preload("res://game/scene/transfer_bursts.gd")

func test_real_particle_frames_match_original_three_callbacks() -> void:
	var cases: Array = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/transfer-oracles.json"))
	assert_eq(cases.size(), 42)
	for example in cases:
		var presentation := Bursts.new()
		Engine.get_main_loop().root.add_child(presentation)
		presentation.add_transfer(example.entry, example.areas)
		for step in example.steps:
			presentation.basket_target = Vector3(step.target[0], step.target[1], step.target[2])
			presentation.advance(step.delta)
			if step.remaining == 0:
				assert_eq(presentation.flights.size(), 0)
				assert_eq(presentation.entries.size(), 0)
				continue
			assert_eq(presentation.entries[0].remainingQuantity, step.remaining)
			var particles: Array = presentation.flights[1].particles
			assert_eq(particles.size(), step.particles.size())
			for index in particles.size():
				var node: Node3D = particles[index].node
				var expected: Dictionary = step.particles[index]
				var label := "%s %s q%s particle%s" % [example.entry.kind, example.entry.productId, example.entry.quantity, index]
				assert_eq(node.visible, expected.visible, label)
				for property in ["position", "rotation", "scale"]:
					var actual: Vector3 = node.get(property)
					for axis in 3: assert_near(actual[axis], expected[property][axis], 0.00001, label + " " + property)
		presentation.free()
