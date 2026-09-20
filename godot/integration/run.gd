extends "res://tests/run_tests.gd"
## Dedicated real HTTP integration suite; never silently skipped as passing.
func _scan(dir_path: String, out: Array[String]) -> void:
	super._scan("res://integration" if dir_path == "res://tests" else dir_path, out)
