class_name DomainEvents
extends RefCounted
## Pure domainEventSchema / validatePendingEvents from persistence/Snapshot.ts.
## Unknown keys are accepted, as in Zod's object safeParse. Input is not mutated.
const UUID_PATTERN = "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
const DATE_PATTERN = "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?Z$"
static var _uuid := RegEx.create_from_string(UUID_PATTERN)
static var _date := RegEx.create_from_string(DATE_PATTERN)

static func validate_pending_events(events: Array) -> bool:
	var seen := {}
	for event in events:
		if not event is Dictionary: return false
		for field in {"franchiseId": 80, "type": 80, "idempotencyKey": 120, "category": 40, "description": 160}:
			var value = event.get(field)
			var limit: int = {"franchiseId": 80, "type": 80, "idempotencyKey": 120, "category": 40, "description": 160}[field]
			if not value is String or value.is_empty() or value.to_utf16_buffer().size() / 2 > limit: return false
		if not event.get("eventId") is String or _uuid.search(event.eventId) == null: return false
		if not event.get("occurredAt") is String or _date.search(event.occurredAt) == null: return false
		if not JS.is_safe_integer(event.get("sequence")) or event.sequence <= 0: return false
		if not JS.is_safe_integer(event.get("amountMinor")): return false
		if not event.get("payload") is Dictionary: return false
		if seen.has(event.idempotencyKey): return false
		seen[event.idempotencyKey] = true
	return true
