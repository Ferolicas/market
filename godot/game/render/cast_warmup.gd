class_name MarketCastWarmup
extends Node3D
## Same six customer bodies as CustomerWarmup, drawn under the loading cover.
static var resources := {}
func prepare(position_world: Vector3) -> void:
	position = position_world + Vector3(0, 0.6, 0)
	var tier := CharacterPresentation.character_model_tier_for_capabilities(CharacterPresentation.current_character_capabilities())
	for source_path in CharacterPresentation.priority_customer_model_paths_for_tier(tier):
		var path: String = "res://assets" + source_path
		if not resources.has(path): resources[path] = load(path)
		var source: Node3D = resources[path].instantiate()
		var model := CharacterPresentation.prepare_character_model(source, {"crowd": true, "reducedDetail": tier > 0})
		source.free()
		model.scale = Vector3.ONE * 0.006
		add_child(model)
