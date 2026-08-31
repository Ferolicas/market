export type FeedbackCue = "footstep" | "harvest" | "pickup" | "stock" | "scanner" | "payment" | "machine" | "door" | "upgrade";
export type FeedbackSource = "player" | "npc" | "system";

export interface FeedbackSignal {
  cue: FeedbackCue;
  source: FeedbackSource;
  actorId?: string;
}

type Listener = (signal: FeedbackSignal) => void;

export class FeedbackBus {
  private listeners = new Set<Listener>();
  emit(cue: FeedbackCue, context: Omit<FeedbackSignal, "cue"> = { source: "system" }) {
    const signal: FeedbackSignal = { cue, ...context };
    this.listeners.forEach((listener) => listener(signal));
  }
  subscribe(listener: Listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}

export const feedbackBus = new FeedbackBus();
