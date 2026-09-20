extends TestCase

func test_original_request_schema_preserves_payload_and_limits_text() -> void:
	var input := {"kind": "save", "name": "conflict", "severity": "warning", "message": "x".repeat(1100), "payload": {"level": 3, "online": false, "missing": null}}
	var actual := MarketClientTelemetry.body(input, "/".repeat(400), "device", "session")
	assert_eq(actual.message.length(), 1000)
	assert_eq(actual.route.length(), 300)
	assert_eq(actual.deviceId, "device")
	assert_eq(actual.sessionId, "session")
	assert_eq(actual.payload, input.payload)
	assert_eq(input.message.length(), 1100, "Reporting cannot mutate store state")
