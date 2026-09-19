extends SceneTree
## Headless test runner: godot --headless --path godot -s tests/run_tests.gd [filter]
## Discovers res://tests/**/test_*.gd, runs every `test_*` method, prints a summary
## and exits with 1 when anything fails.

func _init() -> void:
	var filter := ""
	for arg in OS.get_cmdline_user_args():
		filter = arg
	var files: Array[String] = []
	_scan("res://tests", files)
	files.sort()
	var total_passed := 0
	var total_failed := 0
	var suites := 0
	for file in files:
		if filter != "" and not file.contains(filter): continue
		var script = load(file)
		if script == null:
			print("LOAD FAIL ", file); total_failed += 1; continue
		var suite = script.new()
		if not (suite is TestCase): continue
		suites += 1
		var result: Dictionary = suite._run_all()
		total_passed += result.passed
		var failures: Array = result.failures
		total_failed += failures.size()
		if failures.is_empty():
			print("ok   %s (%d)" % [file, result.passed])
		else:
			print("FAIL %s (%d ok, %d failed)" % [file, result.passed, failures.size()])
			for failure in failures: print("     - ", failure)
	print("\n%d suites, %d passed, %d failed" % [suites, total_passed, total_failed])
	quit(1 if total_failed > 0 else 0)

func _scan(dir_path: String, out: Array[String]) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null: return
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		var full := dir_path.path_join(name)
		if dir.current_is_dir():
			if not name.begins_with("."): _scan(full, out)
		elif name.begins_with("test_") and name.ends_with(".gd"):
			out.append(full)
		name = dir.get_next()
	dir.list_dir_end()
