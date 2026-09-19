class_name SoundDesign
extends RefCounted
## Port of src/game/feedback/SoundDesign.ts.
## sample: "music" | "music-lite" | "silence" | "mission" | "cashier" | "money" | "step-1" | "step-2" | "stock" | "machine"
## CuePlayback Dictionary: { sample, tone, gain, rate, cooldownMs, loop, vibration }.

const SOUND_SAMPLE_URLS := {
	"music": "/audio/music.mp3",
	## Mono 22 kHz copy, small enough to decode whole where the element cannot be routed (iOS).
	"music-lite": "/audio/music-lite.mp3",
	## One silent second: looping it keeps iOS in a playback session so the mute switch spares the game.
	"silence": "/audio/silence.mp3",
	"mission": "/audio/mission-complete.mp3",
	"cashier": "/audio/cashier.mp3",
	"money": "/audio/money-counter.mp3",
	"step-1": "/audio/step-1.mp3",
	"step-2": "/audio/step-2.mp3",
	"stock": "/audio/stock.mp3",
	"machine": "/audio/machine.mp3",
}

## Godot resource path of a sample (the /audio/ URLs live under res://assets/audio/).
static func sample_resource_path(sample: String) -> String:
	return String(SOUND_SAMPLE_URLS[sample]).replace("/audio/", "res://assets/audio/")

## Short samples decoded once after the first gesture so no cue waits for the network.
const EFFECT_SAMPLES := ["mission", "cashier", "money", "step-1", "step-2", "stock", "machine"]

## The money counter keeps looping while pulses keep landing on a marker and
## fades this long after the last one.
const MONEY_LOOP_HOLD_MS := 650

const DESIGN := {
	"footstep": { "sample": "step-1", "tone": null, "gain": 0.5, "rate": [0.9, 1.1], "cooldownMs": 95, "loop": false, "vibration": null },
	"harvest": { "sample": "stock", "tone": null, "gain": 0.4, "rate": [1.3, 1.45], "cooldownMs": 120, "loop": false, "vibration": null },
	"pickup": { "sample": "machine", "tone": null, "gain": 0.55, "rate": [1.05, 1.15], "cooldownMs": 180, "loop": false, "vibration": null },
	"stock": { "sample": "stock", "tone": null, "gain": 0.7, "rate": [0.95, 1.05], "cooldownMs": 110, "loop": false, "vibration": null },
	"machine": { "sample": "machine", "tone": null, "gain": 0.8, "rate": [0.97, 1.03], "cooldownMs": 180, "loop": false, "vibration": null },
	"scanner": { "sample": null, "tone": 920, "gain": 0.25, "rate": [1, 1], "cooldownMs": 120, "loop": false, "vibration": null },
	"door": { "sample": null, "tone": 230, "gain": 0.2, "rate": [1, 1], "cooldownMs": 400, "loop": false, "vibration": null },
	"payment": { "sample": "cashier", "tone": null, "gain": 0.9, "rate": [1, 1], "cooldownMs": 350, "loop": false, "vibration": [30] },
	"upgrade": { "sample": "cashier", "tone": null, "gain": 0.9, "rate": [1, 1], "cooldownMs": 300, "loop": false, "vibration": [40, 40, 40] },
	"mission": { "sample": "mission", "tone": null, "gain": 1, "rate": [1, 1], "cooldownMs": 1000, "loop": false, "vibration": [70, 50, 140] },
	"money": { "sample": "money", "tone": null, "gain": 0.65, "rate": [1, 1], "cooldownMs": 0, "loop": true, "vibration": null },
}

## Footsteps of the crowd stay a murmur under the owner's own steps.
const NPC_FOOTSTEP_GAIN := 0.22
const NPC_FOOTSTEP_COOLDOWN_MS := 140

## random: Callable returning 0..1 (injectable for tests); randf by default.
static func cue_playback(signal_value: Dictionary, random: Callable = Callable()) -> Dictionary:
	var rng := random if random.is_valid() else Callable(SoundDesign, "_randf")
	var design: Dictionary = DESIGN[signal_value.cue]
	var low: float = design.rate[0]
	var high: float = design.rate[1]
	var rate: float = low if low == high else low + (high - low) * float(rng.call())
	if signal_value.cue == "footstep":
		var npc: bool = signal_value.source == "npc"
		return JS.spread(design, {
			"sample": "step-1" if float(rng.call()) < 0.5 else "step-2",
			"rate": rate,
			"gain": design.gain * NPC_FOOTSTEP_GAIN if npc else design.gain,
			"cooldownMs": NPC_FOOTSTEP_COOLDOWN_MS if npc else design.cooldownMs,
		})
	return JS.spread(design, { "rate": rate })

static func _randf() -> float:
	return randf()

static func feedback_channel(signal_value: Dictionary) -> String:
	return "%s:%s:%s" % [signal_value.cue, signal_value.source, JS.get_or(signal_value, "actorId", signal_value.source)]
