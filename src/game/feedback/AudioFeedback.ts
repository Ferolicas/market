import type { FeedbackCue, FeedbackSignal } from "./FeedbackBus";

const frequencies: Record<FeedbackCue, number> = { footstep: 105, harvest: 340, pickup: 480, stock: 280, scanner: 920, payment: 660, machine: 180, door: 230, upgrade: 780 };

export class AudioFeedback {
  private context: AudioContext | null = null;
  private lastPlayed = new Map<string, number>();

  play(signal: FeedbackSignal) {
    const { cue, source } = signal;
    const now = performance.now();
    const cooldown = cue === "footstep" ? 90 : cue === "scanner" ? 120 : 180;
    const channel = feedbackChannel(signal);
    if (now - (this.lastPlayed.get(channel) ?? -Infinity) < cooldown) return;
    this.lastPlayed.set(channel, now);
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
    const start = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = cue === "footstep" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequencies[cue], start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(60, frequencies[cue] * 0.72), start + 0.09);
    gain.gain.setValueAtTime(cue === "footstep" ? source === "npc" ? 0.009 : 0.018 : 0.032, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(start); oscillator.stop(start + 0.12);
  }

  close() { if (this.context) void this.context.close(); this.context = null; }
}

export function feedbackChannel(signal: FeedbackSignal) {
  return `${signal.cue}:${signal.source}:${signal.actorId ?? signal.source}`;
}
