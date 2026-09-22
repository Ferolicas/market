class_name PerformanceLog
extends RefCounted
## A session-wide timeline of every slow operation anywhere in the app, from
## the moment it opens to the moment it closes — not just the handful of
## spots picked by hand so far. Each entry keeps enough context (what
## happened, when since launch, how long, what was going on in the game at
## that moment) that the real cause of a hitch can be read directly off the
## data instead of guessed at. Reported in small batches via the existing
## authenticated telemetry endpoint, so it survives on the server even if the
## app is closed before anyone looks at it.
const THRESHOLD_MS := 16 # one dropped 60fps frame

static var _launch_ms := Time.get_ticks_msec()
static var _entries: Array = []
static var _next_unflushed := 0

## op: short stable name, e.g. "sync_state", "tick_world", "load_rig".
## context: short flat key:value pairs folded into the log line, e.g.
## {"customers": 11, "identity": 3} — kept tiny, this is a label, not payload.
static func record(op: String, duration_ms: float, context: Dictionary = {}) -> void:
	if duration_ms < THRESHOLD_MS: return
	var label := ""
	for key in context: label += ",%s=%s" % [key, context[key]]
	_entries.append("t%d:%s:%dms%s" % [Time.get_ticks_msec() - _launch_ms, op, int(duration_ms), label])
	if _entries.size() > 500: _entries = _entries.slice(_entries.size() - 500) # bound memory on a very long session
	_next_unflushed = mini(_next_unflushed, _entries.size())

## A lifecycle/context marker with no duration — e.g. "foreground", "background",
## "render_phase:compiled" — so gaps in the timeline (a stall too large to
## even reach the next record() call) can still be located.
static func mark(label: String) -> void:
	_entries.append("t%d:%s" % [Time.get_ticks_msec() - _launch_ms, label])

## Returns up to `max_entries` unflushed lines and advances the cursor; call
## sites report these as telemetry. Never returns the same line twice unless
## take_all() is used (e.g. for a final flush on shutdown, which does not
## advance the normal cursor since the app is closing anyway).
static func take_batch(max_entries: int = 8) -> Array:
	if _next_unflushed >= _entries.size(): return []
	var batch: Array = _entries.slice(_next_unflushed, mini(_entries.size(), _next_unflushed + max_entries))
	_next_unflushed += batch.size()
	return batch

static func has_unflushed() -> bool:
	return _next_unflushed < _entries.size()

## Everything recorded this session, for the final flush on app close.
static func take_all_unflushed() -> Array:
	var batch := _entries.slice(_next_unflushed)
	_next_unflushed = _entries.size()
	return batch
