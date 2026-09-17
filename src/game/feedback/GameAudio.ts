import { volumeGain, type AudioSettings } from "./AudioSettings";
import type { FeedbackSignal } from "./FeedbackBus";
import { cuePlayback, EFFECT_SAMPLES, feedbackChannel, MONEY_LOOP_HOLD_MS, SOUND_SAMPLE_URLS, type CuePlayback, type SoundSample } from "./SoundDesign";

/** Headroom under the music so effects and the till stay on top of it. */
const MUSIC_TRIM = 0.85;

/**
 * The page's only sound output: one AudioContext, the looping music element
 * routed through its own gain, decoded one-shot effects, the sustained money
 * counter and vibration. Nothing sounds before the first gesture (`unlock`),
 * which is what browsers demand; the shell keeps calling it on every pointer
 * or key event because it is idempotent and cheap.
 */
export class GameAudio {
  private context: AudioContext | null = null;
  private effectsBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private music: HTMLAudioElement | null = null;
  private buffers = new Map<SoundSample, Promise<AudioBuffer | null>>();
  private lastPlayed = new Map<string, number>();
  private moneyLoop: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private moneyTimer = 0;
  private settings: AudioSettings;
  private unlocked = false;
  private hidden = false;

  constructor(settings: AudioSettings) { this.settings = settings; }

  applySettings(settings: AudioSettings) {
    this.settings = settings;
    if (this.effectsBus) this.effectsBus.gain.value = volumeGain(settings.effects);
    if (settings.effects <= 0) this.stopMoneyLoop(true);
    this.applyMusicGain();
    if (settings.music <= 0) this.music?.pause();
    else this.startMusic();
  }

  /** Call from a user gesture: resumes the context, decodes the effects and starts the music. */
  unlock() {
    const context = this.ensureContext();
    if (!context) return;
    if (context.state === "suspended") void context.resume();
    this.unlocked = true;
    for (const sample of EFFECT_SAMPLES) void this.buffer(sample);
    this.startMusic();
  }

  /** A hidden tab is silent: the music pauses and resumes with the page. */
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    if (hidden) { this.music?.pause(); this.stopMoneyLoop(true); }
    else this.startMusic();
  }

  play(signal: FeedbackSignal) {
    const playback = cuePlayback(signal);
    const now = performance.now();
    const channel = feedbackChannel(signal);
    if (playback.cooldownMs > 0 && now - (this.lastPlayed.get(channel) ?? -Infinity) < playback.cooldownMs) return;
    this.lastPlayed.set(channel, now);
    this.vibrate(playback.vibration);
    if (this.settings.effects <= 0 || this.hidden) return;
    const context = this.context;
    if (!context || !this.effectsBus || context.state !== "running") return;
    if (playback.loop) { this.sustainMoneyLoop(playback); return; }
    if (playback.sample) {
      void this.buffer(playback.sample).then((buffer) => {
        if (!buffer || !this.context || !this.effectsBus) return;
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = playback.rate;
        const gain = this.context.createGain();
        gain.gain.value = playback.gain;
        source.connect(gain).connect(this.effectsBus);
        source.start();
      });
    } else if (playback.tone) this.tone(playback.tone, playback.gain);
  }

  close() {
    this.stopMoneyLoop(true);
    if (this.music) { this.music.pause(); this.music.removeAttribute("src"); this.music.load(); this.music = null; }
    if (this.context) void this.context.close();
    this.context = null; this.effectsBus = null; this.musicBus = null;
    this.buffers.clear();
    this.unlocked = false;
  }

  private ensureContext() {
    if (this.context) return this.context;
    if (typeof AudioContext === "undefined") return null;
    const context = new AudioContext();
    const effects = context.createGain();
    effects.gain.value = volumeGain(this.settings.effects);
    effects.connect(context.destination);
    this.context = context;
    this.effectsBus = effects;
    return context;
  }

  private startMusic() {
    if (!this.unlocked || this.hidden || this.settings.music <= 0 || typeof Audio === "undefined") return;
    if (!this.music) {
      const element = new Audio(SOUND_SAMPLE_URLS.music);
      element.loop = true;
      element.preload = "auto";
      this.music = element;
      // Through the context the level also works where the element ignores
      // `volume` (iOS); if routing is refused the element keeps its own volume.
      if (this.context) {
        try {
          const bus = this.context.createGain();
          this.context.createMediaElementSource(element).connect(bus).connect(this.context.destination);
          this.musicBus = bus;
        } catch { this.musicBus = null; }
      }
      this.applyMusicGain();
    }
    if (this.music.paused) void this.music.play().catch(() => { this.unlocked = false; });
  }

  private applyMusicGain() {
    const gain = volumeGain(this.settings.music) * MUSIC_TRIM;
    if (this.musicBus) this.musicBus.gain.value = gain;
    else if (this.music) this.music.volume = gain;
  }

  private buffer(sample: SoundSample) {
    const cached = this.buffers.get(sample);
    if (cached) return cached;
    const context = this.context;
    if (!context) return Promise.resolve(null);
    const loading = fetch(SOUND_SAMPLE_URLS[sample])
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
      .then((bytes) => context.decodeAudioData(bytes))
      .catch(() => { this.buffers.delete(sample); return null; });
    this.buffers.set(sample, loading);
    return loading;
  }

  private tone(frequency: number, level: number) {
    const context = this.context;
    if (!context || !this.effectsBus) return;
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.72), start + 0.09);
    gain.gain.setValueAtTime(level * 0.12, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
    oscillator.connect(gain).connect(this.effectsBus);
    oscillator.start(start); oscillator.stop(start + 0.12);
  }

  private sustainMoneyLoop(playback: CuePlayback) {
    window.clearTimeout(this.moneyTimer);
    this.moneyTimer = window.setTimeout(() => this.stopMoneyLoop(false), MONEY_LOOP_HOLD_MS);
    if (this.moneyLoop || !playback.sample) return;
    void this.buffer(playback.sample).then((buffer) => {
      if (!buffer || this.moneyLoop || !this.context || !this.effectsBus) return;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this.context.createGain();
      gain.gain.setValueAtTime(0.0001, this.context.currentTime);
      gain.gain.exponentialRampToValueAtTime(playback.gain, this.context.currentTime + 0.06);
      source.connect(gain).connect(this.effectsBus);
      source.start();
      this.moneyLoop = { source, gain };
    });
  }

  private stopMoneyLoop(immediate: boolean) {
    window.clearTimeout(this.moneyTimer);
    const loop = this.moneyLoop;
    if (!loop || !this.context) { this.moneyLoop = null; return; }
    this.moneyLoop = null;
    const at = this.context.currentTime;
    const fade = immediate ? 0.02 : 0.18;
    loop.gain.gain.cancelScheduledValues(at);
    loop.gain.gain.setValueAtTime(Math.max(0.0001, loop.gain.gain.value), at);
    loop.gain.gain.exponentialRampToValueAtTime(0.0001, at + fade);
    loop.source.stop(at + fade + 0.01);
  }

  private vibrate(pattern: number[] | null) {
    if (!pattern || !this.settings.vibration || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    try { navigator.vibrate(pattern); } catch { /* not allowed yet */ }
  }
}

let shared: GameAudio | null = null;
/** One output for the whole page, whichever shell branch mounts the runtime. */
export function sharedGameAudio(settings: AudioSettings) {
  shared ??= new GameAudio(settings);
  return shared;
}
