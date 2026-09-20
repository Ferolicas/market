class_name ClientIdentity
extends RefCounted
static var _session: String = ""
static var _device: String = ""

static func game_session_id() -> String:
	if _session.is_empty(): _session = _browser_identity("sessionStorage", "mini-market-session-id") if OS.has_feature("web") else JS.uuid()
	return _session

static func game_device_id() -> String:
	if not _device.is_empty(): return _device
	if OS.has_feature("web"):
		_device = _browser_identity("localStorage", "mini-market-device-id")
		return _device
	var path := "user://mini-market-device-id"
	if FileAccess.file_exists(path): _device = FileAccess.get_file_as_string(path)
	if _device.is_empty():
		_device = JS.uuid()
		var file := FileAccess.open(path, FileAccess.WRITE)
		if file != null: file.store_string(_device)
	return _device

static func _browser_identity(storage: String, key: String) -> String:
	var fallback := JS.uuid()
	var result: Variant = JavaScriptBridge.eval("(() => { try { const storage = window[%s]; let value = storage.getItem(%s); if (!value) { value = %s; storage.setItem(%s,value); } return value; } catch { return %s; } })()" % [JSON.stringify(storage), JSON.stringify(key), JSON.stringify(fallback), JSON.stringify(key), JSON.stringify(fallback)], true)
	return result if result is String else fallback
