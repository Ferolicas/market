extends SceneTree
## Release gate: use the packaged default, never an injected QA URL.
## Only read-only and deliberately invalid auth requests; creates no accounts.
var failures: Array[String] = []
func _init() -> void: _run.call_deferred()
func _check(condition: bool, message: String) -> void:
	if not condition: failures.append(message)
func _run() -> void:
	var api := MarketApi.new()
	root.add_child(api)
	_check(api.base_url == "https://market.olcas.app", "Native default must be the production HTTPS origin")
	if failures.is_empty():
		var health := await api.request_json("/api/health")
		_check(health.ok and health.data.get("database") == "ok", "Native HTTPS health/database check failed: %s" % health.status)
		var session := await api.request_json("/api/auth/get-session")
		_check(session.ok and session.data.is_empty(), "Anonymous native session check failed: %s" % session.status)
		var email := "native_probe_" + JS.uuid().replace("-", "") + "@example.invalid"
		var login := await api.sign_in(email, "invalid-qa-password")
		_check(login.status == 401 and login.data.get("code") == "INVALID_EMAIL_OR_PASSWORD", "Native login endpoint check failed: %s" % login.status)
		var registration := await api.request_json("/api/auth/sign-up/email", "POST", {"email": email, "password": "short", "name": "Native QA", "username": "native_probe"})
		_check(registration.status == 400 and registration.data.get("code") == "PASSWORD_TOO_SHORT", "Native registration endpoint check failed: %s" % registration.status)
	await process_frame
	api.free()
	for message in failures: printerr(message)
	if failures.is_empty(): print("PASS: packaged native HTTPS origin, production health, session and auth endpoints; no account created")
	quit(0 if failures.is_empty() else 1)
