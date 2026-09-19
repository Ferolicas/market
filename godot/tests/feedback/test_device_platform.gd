extends TestCase

func test_reconoce_iphone_ipad_y_el_ipad_que_se_presenta_como_mac() -> void:
	assert_true(DevicePlatform.is_apple_touch_device({ "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "platform": "iPhone", "maxTouchPoints": 5 }))
	assert_true(DevicePlatform.is_apple_touch_device({ "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "platform": "MacIntel", "maxTouchPoints": 5 }))

func test_deja_fuera_android_escritorio_y_mac_sin_pantalla_tactil() -> void:
	assert_false(DevicePlatform.is_apple_touch_device({ "userAgent": "Mozilla/5.0 (Linux; Android 15; Pixel 9)", "platform": "Linux armv8l", "maxTouchPoints": 5 }))
	assert_false(DevicePlatform.is_apple_touch_device({ "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "platform": "MacIntel", "maxTouchPoints": 0 }))
	assert_false(DevicePlatform.is_apple_touch_device({ "userAgent": "", "platform": "", "maxTouchPoints": 0 }))
