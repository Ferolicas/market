extends Node
class_name GameStore

var game: Dictionary
var save_revision: int = 0
var save_status: String = "idle"
var pending_events: Array = []
var message: Dictionary = {"text": "", "revision": -1}
var _pending_interaction_queue: Array = []
var _recovery_store_path: String = "user://recovery-mini-market.json"
var _last_save_attempt_at: int = 0
var _last_save_successful: int = 0

func _ready():
    # Initialize store with empty game state
    if game == null:
        game = MarketEngine.create_initial_game()
    message = {"text": "", "revision": -1}

func dispatch(action: Dictionary) -> Dictionary:
    if not is_valid_action(action):
        return {"ok": false, "message": "Invalid action", "state": game}
    
    var result = MarketEngine.apply_game_action(game, action)
    result["state"] = game
    return result

func queue_interaction(action: Dictionary):
    _pending_interaction_queue.append(action)

func get_game_state() -> Dictionary:
    return JS.clone(game)

func get_save_status() -> String:
    return save_status

func get_message() -> Dictionary:
    return JS.clone(message)

func set_message(text: String, revision: int = -1):
    message = {"text": text, "revision": revision}

func record_player_distance(meters: float):
    # Simple distance tracking - can be enhanced later
    pass

func tick_world(delta_ms: int):
    # World tick logic - can be implemented based on game requirements
    pass

func save_game():
    save_status = "saving"
    var save_path = get_save_path()
    var success = save_state_to_file(game, save_path)
    if success:
        save_status = "saved"
        _last_save_successful = OS.get_ticks_msec()
    else:
        save_status = "error"
    return success

func load_game() -> bool:
    save_status = "loading"
    var save_path = get_save_path()
    if not FileAccess.file_exists(save_path):
        game = MarketEngine.create_initial_game()
        save_status = "loaded"
        return true
    
    var loaded_data = load_state_from_file(save_path)
    if loaded_data:
        game = loaded_data
        save_status = "loaded"
        return true
    else:
        save_status = "error"
        return false

func adopt_local_copy():
    # Implement recovery logic for local save
    var recovery_path = get_recovery_path()
    if FileAccess.file_exists(recovery_path):
        var recovery_data = load_state_from_file(recovery_path)
        if recovery_data:
            game = recovery_data
            save_status = "restored"

func restore_server_copy():
    # This would be called when server sync is successful
    save_status = "synced"

func get_save_path() -> String:
    return "user://mini-market-save.json"

func get_recovery_path() -> String:
    return "user://recovery-mini-market.json"

func is_valid_action(action: Dictionary) -> bool:
    return action is not null and typeof(action) == "Dictionary" and action.has("type")

func save_state_to_file(state: Dictionary, path: String) -> bool:
    var file = FileAccess.open(path, FileAccess.WRITE)
    if file == null:
        return false
    
    var json_string = JSON.stringify(state, "\t")
    file.store_string(json_string)
    return true

func load_state_from_file(path: String) -> Dictionary:
    if not FileAccess.file_exists(path):
        return null
    
    var file = FileAccess.open(path, FileAccess.READ)
    if file == null:
        return null
    
    var content = file.get_as_text()
    var json_parser = JSON.parse(content)
    if json_parser.error:
        return null
    
    return json_parser.result as Dictionary

func _notification(what: int):
    if what == NOTIFICATION_PREDELETE:
        # Clean up save files when game is deleted
        var save_path = get_save_path()
        var recovery_path = get_recovery_path()
        if FileAccess.file_exists(save_path):
            DirAccess.remove_absolute(ProjectSettings.globalize_path(save_path))
        if FileAccess.file_exists(recovery_path):
            DirAccess.remove_absolute(ProjectSettings.globalize_path(recovery_path))