extends TestCase
var api: MarketApi
var store: MarketStore
var other: MarketApi
var directory: String
var email: String
var password: String
var username: String

func before_each() -> void:
	var base := OS.get_environment("MARKET_QA_API_URL")
	assert_true(base.begins_with("http://127.0.0.1:"), "Requires the disposable loopback QA backend")
	if not base.begins_with("http://127.0.0.1:"): return
	store = MarketStore.new()
	store.recovery = RecoveryStorage.new()
	directory = "user://live-api-" + JS.uuid()
	store.recovery.directory = directory
	store.add_child(store.recovery)
	Engine.get_main_loop().root.add_child(store)
	api = store.api
	api.base_url = base
	api.session_directory = directory
	other = MarketApi.new()
	other.base_url = base
	Engine.get_main_loop().root.add_child(other)
	username = "godot_" + JS.uuid().replace("-", "").substr(0, 12)
	email = username + "@example.invalid"
	password = JS.uuid() + "-qa"

func after_each() -> void:
	await Engine.get_main_loop().process_frame
	if store != null: store.free()
	if other != null: other.free()
	var files := DirAccess.open(directory)
	if files != null:
		for file in files.get_files(): files.remove(file)
		DirAccess.remove_absolute(directory)
	NavMeshService.dispose_store_navigation()

func test_native_auth_save_replay_conflict_and_signout_against_original_backend() -> void:
	if api == null: return
	var denied := await api.request_json("/api/game/save")
	assert_eq(denied.status, 401)
	var signup := await api.request_json("/api/auth/sign-up/email", "POST", {"email": email, "username": username, "password": password, "name": "Godot Migration QA"})
	assert_true(signup.ok, "Real Better Auth signup: " + str(signup.status))
	if not signup.ok: return
	var session := await api.request_json("/api/auth/get-session")
	assert_eq(session.data.user.email, email)
	var telemetry := MarketClientTelemetry.new()
	telemetry.store = store
	store.add_child(telemetry)
	var reported := await telemetry.report({"kind": "performance", "name": "one-minute-window", "severity": "info", "payload": {"frameCount": 3600, "averageFrameMs": 16.67, "p95FrameMs": 16.67, "longTaskCount": 0}})
	assert_eq(reported.status, 201, "Original backend must persist native telemetry")
	telemetry.free()
	var resumed := MarketApi.new()
	resumed.base_url = api.base_url
	resumed.session_directory = directory
	Engine.get_main_loop().root.add_child(resumed)
	var resumed_session := await resumed.request_json("/api/auth/get-session")
	assert_eq(resumed_session.data.user.email, email, "A new native client restores the real persistent Better Auth cookie")
	await Engine.get_main_loop().process_frame
	resumed.free()

	await store.load_game()
	assert_not_null(store.game)
	if store.game == null: return
	assert_eq(store.save_revision, 1)
	assert_eq(store.game.countryCode, "ES")
	assert_true(store.dispatch({"type": "SET_COUNTRY", "countryCode": "CO"}).ok)
	var attempt: Dictionary = store.begin_save_attempt()
	var headers := {"x-market-release": RecoveryStorage.CAMPAIGN_RELEASE}
	var saved := await api.request_json("/api/game/save", "PUT", attempt, headers)
	assert_true(saved.ok, "Server validates native state/events: " + str(saved.data))
	if not saved.ok: return
	store.finish_save_attempt(attempt, saved)
	assert_eq(store.save_status, "saved")
	assert_eq(store.save_revision, 2)
	var replay := await api.request_json("/api/game/save", "PUT", attempt, headers)
	assert_true(replay.ok)
	assert_eq(replay.data.saveRevision, 2)
	var login := await other.sign_in(username, password)
	assert_true(login.ok, "Username sign-in uses the real plugin endpoint")
	var loaded := await other.request_json("/api/game/save")
	assert_eq(loaded.data.state.countryCode, "CO")
	assert_eq(loaded.data.saveRevision, 2)
	var stale := attempt.duplicate(true)
	stale.operationId = JS.uuid()
	var conflict := await other.request_json("/api/game/save", "PUT", stale, headers)
	assert_eq(conflict.status, 409)
	assert_true(store.dispatch({"type": "TOGGLE_STORE"}).ok)
	await store.save_game()
	assert_eq(store.save_status, "saved")
	assert_eq(store.save_revision, 3)
	var signout := await other.sign_out()
	assert_true(signout.ok)
	var no_session := await other.request_json("/api/game/save")
	assert_eq(no_session.status, 401)

func test_real_password_reset_form_changes_password_and_consumes_token() -> void:
	var token := OS.get_environment("MARKET_QA_RESET_TOKEN")
	var reset_email := OS.get_environment("MARKET_QA_RESET_EMAIL")
	var old_password := OS.get_environment("MARKET_QA_RESET_PASSWORD")
	assert_false(token.is_empty(), "Real Better Auth reset fixture is required")
	if token.is_empty(): return
	var screen := MarketAuthScreen.new()
	screen.api = api
	screen.mode = "reset"
	screen.reset_token = token
	Engine.get_main_loop().root.add_child(screen)
	var new_password := JS.uuid() + "-updated"
	screen.fields.password.text = new_password
	screen.fields.confirm.text = new_password
	await screen._submit()
	assert_eq(screen.status.text, "Contraseña actualizada. Ya puedes volver a entrar.")
	var old_login := await other.sign_in(reset_email, old_password)
	assert_false(old_login.ok, "Original password is revoked")
	var new_login := await other.sign_in(reset_email, new_password)
	assert_true(new_login.ok, "New password authenticates against original backend")
	await screen._submit()
	assert_ne(screen.status.text, "Contraseña actualizada. Ya puedes volver a entrar.", "Single-use token cannot be replayed")
	screen.free()

func test_native_registration_and_login_forms_against_real_backend() -> void:
	var screen := MarketAuthScreen.new()
	screen.api = api
	screen.mode = "register"
	var authenticated_users: Array = []
	screen.authenticated.connect(func(user: Dictionary): authenticated_users.append(user))
	Engine.get_main_loop().root.add_child(screen)
	screen.fields.name.text = "Native form QA"
	screen.fields.username.text = username
	screen.fields.identity.text = email
	screen.fields.password.text = password
	await screen._submit()
	assert_eq(authenticated_users.size(), 1, screen.status.text)
	var session := await api.request_json("/api/auth/get-session")
	assert_eq(session.data.get("user", {}).get("email"), email)
	await api.sign_out()
	screen.mode = "login"
	screen._show_mode()
	screen.fields.identity.text = email
	screen.fields.password.text = password
	await screen._submit()
	assert_eq(authenticated_users.size(), 2, screen.status.text)
	await api.sign_out()
	screen.fields.identity.text = username
	await screen._submit()
	assert_eq(authenticated_users.size(), 3, screen.status.text)
	assert_false(screen.busy)
	assert_false(screen.submit_button.disabled)
	screen.free()
