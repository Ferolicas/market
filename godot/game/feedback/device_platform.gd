class_name DevicePlatform
extends RefCounted
## Port of src/game/feedback/DevicePlatform.ts. Hints: { userAgent, platform, maxTouchPoints }.

## iPhone and iPad (including iPadOS pretending to be a Mac): Safari's audio
## rules differ there, whatever browser icon the user tapped.
static func is_apple_touch_device(hints: Dictionary) -> bool:
	var apple := RegEx.create_from_string("iP(hone|ad|od)")
	return apple.search(hints.userAgent) != null or (hints.platform == "MacIntel" and hints.maxTouchPoints > 1)

## Builds browser-like hints from the Godot runtime: OS name + device model as
## the user agent ("iOS iPhone14,2"), "MacIntel" on macOS, touch points from the
## display server.
static func current_device_hints() -> Dictionary:
	var os_name := OS.get_name()
	var user_agent := "%s %s" % [os_name, OS.get_model_name()]
	if os_name == "iOS" and not user_agent.contains("iP"): user_agent += " iPhone"
	var platform := "MacIntel" if os_name == "macOS" else os_name
	var touch_points := 5 if (DisplayServer.is_touchscreen_available() or OS.has_feature("mobile")) else 0
	return { "userAgent": user_agent, "platform": platform, "maxTouchPoints": touch_points }
