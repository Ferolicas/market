extends TestCase
const Api = preload("res://game/persistence/market_api.gd")
var directory: String

func before_each() -> void:
	directory = "user://test-auth-sessions-" + JS.uuid()

func after_each() -> void:
	var dir := DirAccess.open(directory)
	if dir != null:
		for file in dir.get_files(): dir.remove(file)
		DirAccess.remove_absolute(directory)

func _make_api() -> Api:
	var api := Api.new()
	api.session_directory = directory
	Engine.get_main_loop().root.add_child(api)
	return api

## Better Auth omits Max-Age on some Set-Cookie responses (session-scoped
## cookies); losing those on restart was why a real login stopped surviving
## an app relaunch even though sign-in itself worked.
func test_remembers_a_session_cookie_that_has_no_max_age() -> void:
	var api := _make_api()
	api._cookies["market.session_token"] = "signed-token-value"
	api._persist_session()
	api.free()
	var reopened := _make_api()
	assert_true(reopened.has_saved_session())
	reopened.free()

func test_remembers_a_cookie_with_a_future_max_age() -> void:
	var api := _make_api()
	api._cookies["market.session_token"] = "signed-token-value"
	api._cookie_expiry["market.session_token"] = Time.get_unix_time_from_system() + 604800
	api._persist_session()
	api.free()
	var reopened := _make_api()
	assert_true(reopened.has_saved_session())
	reopened.free()

func test_forgets_a_cookie_whose_max_age_already_elapsed() -> void:
	var api := _make_api()
	api._cookies["market.session_token"] = "signed-token-value"
	api._cookie_expiry["market.session_token"] = Time.get_unix_time_from_system() - 10
	api._persist_session()
	api.free()
	var reopened := _make_api()
	assert_false(reopened.has_saved_session())
	reopened.free()

func test_reports_no_saved_session_when_nothing_was_ever_persisted() -> void:
	var api := _make_api()
	assert_false(api.has_saved_session())
	api.free()
