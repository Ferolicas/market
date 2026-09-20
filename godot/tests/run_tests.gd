extends SceneTree
## Headless runner. Load failures and empty selections are failures.

var errors = preload("res://tests/error_collector.gd").new()

func _init() -> void:
	OS.add_logger(errors)
	_run.call_deferred()

func _run() -> void:
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
		if script == null or not script.can_instantiate():
			print("LOAD FAIL ", file)
			total_failed += 1
			continue
		var suite = script.new()
		if not (suite is TestCase):
			print("INVALID TEST CASE ", file)
			total_failed += 1
			continue
		suites += 1
		suite.error_count = errors.count
		suite.error_collector = errors
		var result: Dictionary = await suite._run_all()
		total_passed += result.passed
		var failures: Array = result.failures
		total_failed += failures.size()
		if result.passed == 0 and failures.is_empty():
			failures.append("Empty suite")
			total_failed += 1
		print("%s %s (%d passed, %d failed)" % ["ok" if failures.is_empty() else "FAIL", file, result.passed, failures.size()])
		for failure in failures: print("     - ", failure)
	if suites == 0: total_failed += 1
	print("\n%d suites, %d passed, %d failed" % [suites, total_passed, total_failed])
	var engine_errors: int = errors.count()
	if engine_errors > 0: print("ENGINE ERRORS: ", engine_errors)
	OS.remove_logger(errors)
	quit(1 if total_failed > 0 or engine_errors > 0 else 0)

func _scan(dir_path: String, out: Array[String]) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null: return
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		var full := dir_path.path_join(name)
		if dir.current_is_dir():
			if not name.begins_with("."): _scan(full, out)
		elif name != "test_case.gd" and name.begins_with("test_") and name.ends_with(".gd"):
			out.append(full)
		name = dir.get_next()
	dir.list_dir_end()
