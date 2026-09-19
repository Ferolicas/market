class_name SaveBadgePolicy
extends RefCounted
## Port of src/game/feedback/SaveBadgePolicy.ts.
## status: "idle" | "loading" | "dirty" | "saving" | "saved" | "offline" | "conflict" | "error"
## tone: "saved" | "dirty" | "saving" | "offline" | "conflict" | "error"

## The world marks the game dirty ten times a second, so "dirty" alone means
## nothing to the owner. The badge reads GUARDADO while a confirmed save is
## this fresh; the autosave runs every 30 s, so anything older is a stall.
const SAVE_BADGE_STALE_MS := 90000

## What the HUD badge shows: the internal save status for the degraded states,
## and otherwise whether the last confirmed save (server acknowledgement or a
## fresh load) is recent enough to count as saved. Returns { label, tone }.
static func save_badge_presentation(status: String, last_save_confirmed_at: float, now_ms: float) -> Dictionary:
	if status == "saving": return { "label": "GUARDANDO", "tone": "saving" }
	if status == "offline": return { "label": "COPIA LOCAL", "tone": "offline" }
	if status == "conflict": return { "label": "CONFLICTO", "tone": "conflict" }
	if status == "error": return { "label": "ERROR", "tone": "error" }
	var confirmed := is_finite(last_save_confirmed_at) and last_save_confirmed_at > 0
	var fresh := confirmed and now_ms - last_save_confirmed_at <= SAVE_BADGE_STALE_MS
	return { "label": "GUARDADO", "tone": "saved" } if (fresh or status == "saved") else { "label": "SIN GUARDAR", "tone": "dirty" }
