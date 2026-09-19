class_name FeedbackBus
extends RefCounted
## Port of src/game/feedback/FeedbackBus.ts.
## cue: "footstep" | "harvest" | "pickup" | "stock" | "scanner" | "payment" | "machine" | "door" | "upgrade" | "mission" | "money"
## source: "player" | "npc" | "system". Signal Dictionary: { cue, source, actorId? }.

var _listeners: Array[Callable] = []

static var _shared: FeedbackBus = null

## The page-wide bus (`feedbackBus`).
static func shared() -> FeedbackBus:
	if _shared == null: _shared = FeedbackBus.new()
	return _shared

func emit(cue: String, context: Dictionary = { "source": "system" }) -> void:
	var signal_value := JS.spread({ "cue": cue }, context)
	for listener in _listeners.duplicate(): listener.call(signal_value)

## Returns the unsubscribe Callable.
func subscribe(listener: Callable) -> Callable:
	if not _listeners.has(listener): _listeners.append(listener)
	return func(): _listeners.erase(listener)
