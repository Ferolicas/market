class_name MarketApi
extends Node
## Uses the existing authenticated API; accounts and save revisions stay server-owned.
@export var base_url: String = "http://127.0.0.1:4010"
var _cookies: Dictionary = {}
var session_directory := ""
var _cookie_origin := ""
var _cookie_expiry := {}

func _session_path() -> String:
	return session_directory.path_join(base_url.trim_suffix("/").sha256_text() + ".json")

func _load_session() -> void:
	var origin := base_url.trim_suffix("/")
	if _cookie_origin == origin: return
	_cookie_origin = origin
	_cookies.clear()
	_cookie_expiry.clear()
	if session_directory.is_empty() or not FileAccess.file_exists(_session_path()): return
	var saved: Variant = JSON.parse_string(FileAccess.get_file_as_string(_session_path()))
	if not saved is Dictionary: return
	for key in saved:
		var cookie: Variant = saved[key]
		if cookie is Dictionary and cookie.get("value") is String and float(cookie.get("expires", 0)) > Time.get_unix_time_from_system():
			_cookies[key] = cookie.value
			_cookie_expiry[key] = cookie.expires

func _persist_session() -> void:
	if session_directory.is_empty(): return
	var saved := {}
	for key in _cookies:
		if _cookie_expiry.get(key, 0) > Time.get_unix_time_from_system(): saved[key] = {"value": _cookies[key], "expires": _cookie_expiry[key]}
	DirAccess.make_dir_recursive_absolute(session_directory)
	var file := FileAccess.open(_session_path(), FileAccess.WRITE)
	if file == null: return
	file.store_string(JSON.stringify(saved))
	file.close()
	if OS.get_name() in ["Linux", "macOS"]: FileAccess.set_unix_permissions(_session_path(), FileAccess.UNIX_READ_OWNER | FileAccess.UNIX_WRITE_OWNER)


func request_json(path: String, method: String = "GET", payload: Variant = null, extra_headers: Dictionary = {}, keepalive: bool = false) -> Dictionary:
	var url := base_url.trim_suffix("/") + path
	if OS.has_feature("web"): return await _web_request(url, method, payload, extra_headers, keepalive)
	_load_session()
	for key in _cookie_expiry.keys():
		if _cookie_expiry[key] <= Time.get_unix_time_from_system():
			_cookies.erase(key)
			_cookie_expiry.erase(key)
	var request := HTTPRequest.new()
	request.max_redirects = 0
	request.timeout = 30
	add_child(request)
	var headers := PackedStringArray(["Accept: application/json", "Cache-Control: no-store"])
	if payload != null: headers.append("Content-Type: application/json")
	# Better Auth verifies the application's origin for mutating requests.
	headers.append("Origin: " + base_url.trim_suffix("/"))
	for key in extra_headers: headers.append(str(key) + ": " + str(extra_headers[key]))
	if not _cookies.is_empty():
		var cookies: Array[String] = []
		for key in _cookies: cookies.append(key + "=" + _cookies[key])
		headers.append("Cookie: " + "; ".join(cookies))
	var methods := {"GET": HTTPClient.METHOD_GET, "POST": HTTPClient.METHOD_POST, "PUT": HTTPClient.METHOD_PUT, "DELETE": HTTPClient.METHOD_DELETE}
	var started := request.request(url, headers, methods[method], "" if payload == null else JSON.stringify(payload, "", false, true))
	if started != OK:
		request.queue_free()
		return {"ok": false, "status": 0, "data": {}, "transportError": started}
	var response: Array = await request.request_completed
	request.queue_free()
	for header in response[2]:
		if not header.to_lower().begins_with("set-cookie:"): continue
		var pair: String = header.substr(header.find(":") + 1).strip_edges().get_slice(";", 0)
		var equals := pair.find("=")
		if equals > 0:
			var key := pair.substr(0, equals)
			var value := pair.substr(equals + 1)
			var max_age: Variant = null
			for attribute in header.split(";"):
				var part: String = attribute.strip_edges()
				if part.to_lower().begins_with("max-age="): max_age = int(part.get_slice("=", 1))
			if value.is_empty() or (max_age != null and max_age <= 0):
				_cookies.erase(key)
				_cookie_expiry.erase(key)
			else:
				_cookies[key] = value
				if max_age != null: _cookie_expiry[key] = Time.get_unix_time_from_system() + max_age
				else: _cookie_expiry.erase(key)
	_persist_session()
	var data: Variant = preload("res://game/util/json_exact.gd").parse(response[3].get_string_from_utf8())
	var status: int = response[1]
	return {"ok": response[0] == HTTPRequest.RESULT_SUCCESS and status >= 200 and status < 300, "status": status, "data": data if data is Dictionary else {}, "transportError": response[0]}

func _web_request(url: String, method: String, payload: Variant, extra_headers: Dictionary, keepalive: bool = false) -> Dictionary:
	var token := "market-godot-" + JS.uuid()
	var headers := extra_headers.duplicate()
	headers["Accept"] = "application/json"
	if payload != null: headers["Content-Type"] = "application/json"
	var options := {"method": method, "headers": headers, "credentials": "include", "cache": "no-store"}
	if payload != null: options.body = JSON.stringify(payload, "", false, true)
	# Match GameRuntime's bounded keepalive: larger saves remain in recovery.
	options.keepalive = keepalive and str(options.get("body", "")).to_utf8_buffer().size() <= 60000
	var barrier := "window.__marketGodotRecovery?.settled?.()" if method == "PUT" and url.ends_with("/api/game/save") else "undefined"
	var script := "window.__marketGodotRequests ??= {}; Promise.resolve(%s).then(() => fetch(%s, %s)).then(async r => { let data = {}; try { data = await r.json(); } catch {} window.__marketGodotRequests[%s] = JSON.stringify({ok:r.ok,status:r.status,data}); }).catch(() => { window.__marketGodotRequests[%s] = JSON.stringify({ok:false,status:0,data:{}}); });" % [barrier, JSON.stringify(url), JSON.stringify(options), JSON.stringify(token), JSON.stringify(token)]
	JavaScriptBridge.eval(script, true)
	var deadline := Time.get_ticks_msec() + 32000
	while Time.get_ticks_msec() < deadline:
		var result: Variant = JavaScriptBridge.eval("window.__marketGodotRequests[%s] ?? null" % JSON.stringify(token), true)
		if result is String:
			JavaScriptBridge.eval("delete window.__marketGodotRequests[%s]" % JSON.stringify(token), true)
			return preload("res://game/util/json_exact.gd").parse(result)
		await get_tree().process_frame
	return {"ok": false, "status": 0, "data": {}}

func sign_in(email: String, password: String) -> Dictionary:
	var identity := email.strip_edges().to_lower()
	return await request_json("/api/auth/sign-in/email" if "@" in identity else "/api/auth/sign-in/username", "POST", {"email" if "@" in identity else "username": identity, "password": password})

func sign_out() -> Dictionary:
	var result := await request_json("/api/auth/sign-out", "POST", {})
	if result.ok:
		_cookies.clear()
		_cookie_expiry.clear()
		_persist_session()
	return result
