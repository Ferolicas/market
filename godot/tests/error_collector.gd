extends Logger
## Godot runtime errors do not throw exceptions; capture them explicitly.
var _lock := Mutex.new()
var _count := 0
var _messages: Array[String] = []

func _log_error(_function: String, _file: String, _line: int, _code: String, _rationale: String, _editor_notify: bool, error_type: int, _script_backtraces: Array[ScriptBacktrace]) -> void:
	if error_type == ERROR_TYPE_WARNING: return
	_lock.lock()
	_count += 1
	_messages.append(_rationale if not _rationale.is_empty() else _code)
	_lock.unlock()

func count() -> int:
	_lock.lock()
	var value := _count
	_lock.unlock()
	return value

func consume_expected(message: String, previous_count: int) -> bool:
	_lock.lock()
	var matched := _count == previous_count + 1 and not _messages.is_empty() and _messages[-1] == message
	if matched:
		_count -= 1
		_messages.pop_back()
	_lock.unlock()
	return matched
