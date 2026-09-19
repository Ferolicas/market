class_name WorkstationController
extends RefCounted
## Port of src/game/interaction/WorkstationController.ts.
##
## Separates locomotion from stationary work. Entering a workstation consumes
## the movement that brought the player there; after the input returns to
## neutral, a new deliberate movement cancels the activity and lets them exit.

var _zone_id: Variant = null
var _waiting_for_neutral := false
var _cancelled_until_exit := false

func sync(zone_id: Variant, input_magnitude: float) -> void:
	if zone_id == _zone_id: return
	_zone_id = zone_id
	_cancelled_until_exit = false
	_waiting_for_neutral = zone_id != null and input_magnitude > 0.08

func update_input(input_magnitude: float) -> bool:
	if _zone_id == null or _cancelled_until_exit: return false
	if _waiting_for_neutral:
		if input_magnitude <= 0.08: _waiting_for_neutral = false
		return true
	if input_magnitude >= 0.16:
		_cancelled_until_exit = true
		return false
	return true

func can_perform(zone_id: String) -> bool:
	return _zone_id == zone_id and not _cancelled_until_exit

func performing_zone_id() -> Variant:
	return _zone_id if (_zone_id != null and not _cancelled_until_exit) else null

## { zoneId, locked, waitingForNeutral, cancelledUntilExit }
func snapshot() -> Dictionary:
	return {
		"zoneId": _zone_id,
		"locked": _zone_id != null and not _cancelled_until_exit,
		"waitingForNeutral": _waiting_for_neutral,
		"cancelledUntilExit": _cancelled_until_exit,
	}
