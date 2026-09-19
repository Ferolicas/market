class_name GameAudio
extends Node
## Port of src/game/feedback/GameAudio.ts (scene-facing).
##
## The game's only sound output: the looping music on the "Music" bus, decoded
## one-shot effects and the sustained money counter on the "Effects" bus,
## synthesized scanner/door tones through an AudioStreamGenerator, and
## vibration through Input.vibrate_handheld. `unlock()` stays the entry point
## (idempotent; the web export still needs a first gesture) and `set_hidden`
## pauses the music while the window has no focus.
##
## iPhone/iPad keep the decision of the web version: the music is the smaller
## mono "music-lite" decode. Godot owns the playback session, so the silent
## keep-alive element and the media-element routing are not needed.

## Headroom under the music so effects and the till stay on top of it.
const MUSIC_TRIM := 0.85
const MUSIC_BUS := "Music"
const EFFECTS_BUS := "Effects"
const EFFECT_PLAYER_POOL := 8
const TONE_MIX_RATE := 22050.0

var _settings: Dictionary
var _apple_touch: bool = DevicePlatform.is_apple_touch_device(DevicePlatform.current_device_hints())
var _unlocked := false
var _hidden := false
var _music: AudioStreamPlayer = null
var _effect_players: Array[AudioStreamPlayer] = []
var _tone_player: AudioStreamPlayer = null
var _streams := {}
var _last_played := {}
var _money_loop: AudioStreamPlayer = null
var _money_deadline_ms := -1
var _money_fade: Tween = null

static var _shared: GameAudio = null

## One output for the whole game, whichever shell branch mounts the runtime.
static func shared_game_audio(settings: Dictionary) -> GameAudio:
	if _shared == null: _shared = GameAudio.new(settings)
	return _shared

func _init(settings: Dictionary = AudioSettings.DEFAULT_AUDIO_SETTINGS) -> void:
	_settings = settings
	name = "GameAudio"
	process_mode = Node.PROCESS_MODE_ALWAYS

func settings() -> Dictionary:
	return _settings

func apply_settings(settings: Dictionary) -> void:
	_settings = settings
	_set_bus_gain(EFFECTS_BUS, AudioSettings.volume_gain(settings.effects))
	if settings.effects <= 0: _stop_money_loop(true)
	_apply_music_gain()
	if settings.music <= 0: _pause_music()
	else: _start_music()

## Call from a user gesture: decodes the effects and starts the music.
func unlock() -> void:
	_unlocked = true
	_set_bus_gain(EFFECTS_BUS, AudioSettings.volume_gain(_settings.effects))
	for sample in SoundDesign.EFFECT_SAMPLES: _stream(sample)
	_start_music()

func is_unlocked() -> bool:
	return _unlocked

## A hidden window is silent: the music pauses and resumes with focus.
func set_hidden(hidden: bool) -> void:
	_hidden = hidden
	if hidden:
		_pause_music()
		_stop_money_loop(true)
	else:
		_start_music()

## Returns true when the cue passed its channel cooldown (it vibrated and,
## with effects enabled, sounded).
func play(signal_value: Dictionary) -> bool:
	var playback := SoundDesign.cue_playback(signal_value)
	var now := Time.get_ticks_msec()
	var channel := SoundDesign.feedback_channel(signal_value)
	if playback.cooldownMs > 0 and _last_played.has(channel) and now - int(_last_played[channel]) < playback.cooldownMs: return false
	_last_played[channel] = now
	_vibrate(playback.vibration)
	if _settings.effects <= 0 or _hidden: return true
	if not _unlocked or not is_inside_tree(): return true
	if playback.loop:
		_sustain_money_loop(playback)
		return true
	if playback.sample != null:
		var stream := _stream(playback.sample)
		if stream == null: return true
		var player := _free_effect_player()
		player.stream = stream
		player.pitch_scale = playback.rate
		player.volume_db = linear_to_db(playback.gain)
		player.play()
	elif playback.tone != null:
		_tone(float(playback.tone), playback.gain)
	return true

func close() -> void:
	_stop_money_loop(true)
	_pause_music()
	if _music != null:
		_music.stop()
		_music.stream = null
	for player in _effect_players: player.stop()
	if _tone_player != null: _tone_player.stop()
	_streams.clear()
	_unlocked = false

func _process(_delta: float) -> void:
	if _money_deadline_ms >= 0 and Time.get_ticks_msec() >= _money_deadline_ms:
		_money_deadline_ms = -1
		_stop_money_loop(false)

func _notification(what: int) -> void:
	match what:
		NOTIFICATION_APPLICATION_FOCUS_OUT, NOTIFICATION_APPLICATION_PAUSED: set_hidden(true)
		NOTIFICATION_APPLICATION_FOCUS_IN, NOTIFICATION_APPLICATION_RESUMED: set_hidden(false)

func _set_bus_gain(bus: String, gain: float) -> void:
	var index := AudioServer.get_bus_index(bus)
	if index < 0: return
	AudioServer.set_bus_volume_db(index, linear_to_db(maxf(0.0001, gain)))
	AudioServer.set_bus_mute(index, gain <= 0.0)

func _start_music() -> void:
	if not _unlocked or _hidden or _settings.music <= 0 or not is_inside_tree(): return
	if _music == null:
		var stream := _stream("music-lite" if _apple_touch else "music")
		if stream == null: return
		if stream is AudioStreamMP3: (stream as AudioStreamMP3).loop = true
		var player := AudioStreamPlayer.new()
		player.name = "Music"
		player.bus = MUSIC_BUS
		player.stream = stream
		add_child(player)
		_music = player
		_apply_music_gain()
	if _music.stream_paused: _music.stream_paused = false
	elif not _music.playing: _music.play()

func _pause_music() -> void:
	if _music != null and _music.playing: _music.stream_paused = true

func _apply_music_gain() -> void:
	_set_bus_gain(MUSIC_BUS, AudioSettings.volume_gain(_settings.music) * MUSIC_TRIM)

func _stream(sample: String) -> AudioStream:
	if _streams.has(sample): return _streams[sample]
	var path := SoundDesign.sample_resource_path(sample)
	if not ResourceLoader.exists(path): return null
	var stream: AudioStream = load(path)
	if stream == null: return null
	_streams[sample] = stream
	return stream

func _free_effect_player() -> AudioStreamPlayer:
	for player in _effect_players:
		if not player.playing: return player
	var player := AudioStreamPlayer.new()
	player.bus = EFFECTS_BUS
	add_child(player)
	if _effect_players.size() < EFFECT_PLAYER_POOL:
		_effect_players.append(player)
	else:
		player.finished.connect(player.queue_free)
	return player

## Sine ping: frequency glides to max(60, f × 0.72) over 90 ms while the
## level decays from level × 0.12 to silence over 110 ms; 120 ms long.
func _tone(frequency: float, level: float) -> void:
	if _tone_player == null:
		var generator := AudioStreamGenerator.new()
		generator.mix_rate = TONE_MIX_RATE
		generator.buffer_length = 0.25
		_tone_player = AudioStreamPlayer.new()
		_tone_player.name = "Tone"
		_tone_player.bus = EFFECTS_BUS
		_tone_player.stream = generator
		add_child(_tone_player)
	if not _tone_player.playing: _tone_player.play()
	var playback := _tone_player.get_stream_playback() as AudioStreamGeneratorPlayback
	if playback == null: return
	var frames := int(TONE_MIX_RATE * 0.12)
	var end_frequency := maxf(60.0, frequency * 0.72)
	var start_gain := level * 0.12
	var phase := 0.0
	for frame in frames:
		var t := float(frame) / TONE_MIX_RATE
		var f := frequency * pow(end_frequency / frequency, minf(1.0, t / 0.09))
		var gain := start_gain * pow(0.0001 / maxf(0.0001, start_gain), minf(1.0, t / 0.11)) if t <= 0.11 else 0.0
		phase = fmod(phase + f / TONE_MIX_RATE, 1.0)
		var value := sin(phase * TAU) * gain
		if not playback.can_push_frame(): break
		playback.push_frame(Vector2(value, value))

func _sustain_money_loop(playback: Dictionary) -> void:
	_money_deadline_ms = Time.get_ticks_msec() + SoundDesign.MONEY_LOOP_HOLD_MS
	if _money_loop != null or playback.sample == null: return
	var stream := _stream(playback.sample)
	if stream == null: return
	var looped: AudioStream = stream.duplicate()
	if looped is AudioStreamMP3: (looped as AudioStreamMP3).loop = true
	var player := AudioStreamPlayer.new()
	player.name = "MoneyLoop"
	player.bus = EFFECTS_BUS
	player.stream = looped
	player.volume_db = linear_to_db(0.0001)
	add_child(player)
	player.play()
	_money_loop = player
	if _money_fade != null: _money_fade.kill()
	_money_fade = create_tween()
	_money_fade.tween_property(player, "volume_db", linear_to_db(playback.gain), 0.06)

func _stop_money_loop(immediate: bool) -> void:
	_money_deadline_ms = -1
	var loop := _money_loop
	if loop == null: return
	_money_loop = null
	if _money_fade != null: _money_fade.kill()
	var fade := 0.02 if immediate else 0.18
	if not is_inside_tree():
		loop.queue_free()
		return
	_money_fade = create_tween()
	_money_fade.tween_property(loop, "volume_db", linear_to_db(0.0001), fade)
	_money_fade.tween_interval(0.01)
	_money_fade.tween_callback(loop.queue_free)

## pattern: [vibrate ms, pause ms, vibrate ms, ...] like navigator.vibrate.
func _vibrate(pattern: Variant) -> void:
	if pattern == null or not _settings.vibration: return
	if not OS.has_feature("mobile") and not OS.has_feature("web"): return
	_vibrate_step(pattern, 0)

func _vibrate_step(pattern: Array, index: int) -> void:
	if index >= pattern.size(): return
	var duration := int(pattern[index])
	Input.vibrate_handheld(duration)
	if index + 1 >= pattern.size() or not is_inside_tree(): return
	var pause := int(pattern[index + 1]) if index + 1 < pattern.size() else 0
	get_tree().create_timer(float(duration + pause) / 1000.0).timeout.connect(func(): _vibrate_step(pattern, index + 2))
