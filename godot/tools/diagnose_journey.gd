extends SceneTree
func _init() -> void: run.call_deferred()
func run() -> void:
	var game := MarketEngine.create_campaign_game()
	var franchise := EngineProgression.current_franchise(game)
	var zones := SceneInteractionZones.configs(1, franchise.unlockedAreas, ["crop-tomato-1"], [])
	var nav := NavMeshService.new()
	nav.rebuild(franchise.unlockedAreas, 1)
	for zone in zones:
		if zone.id != "stock:produce": continue
		print("ZONE ", zone)
		print("PATH ",nav.find_path(Vector3(-54.7158966064453/6, 0, -101.653335571289/6),Vector3(zone.x/2,0,zone.z/2)))
	print("MAGNETS ",RetailLayout.retail_stocking_magnets("produce", 2, 1.6,franchise.unlockedAreas))
	nav.dispose()
	quit()
