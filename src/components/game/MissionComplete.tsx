"use client";

import { useEffect, useRef } from "react";

const VISIBLE_MS = 3_000;

/**
 * Full-screen celebration for a finished purchase: no button, no decision,
 * three seconds of letters landing one by one and then it clears itself.
 */
export function MissionComplete({ label, onDone }: { label: string; onDone: () => void }) {
  // The shell re-renders with every world tick, so the dismissal must not
  // depend on the identity of its callback or the card would never leave.
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    const timer = setTimeout(() => done.current(), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [label]);
  const title = "¡MISIÓN COMPLETADA!";

  return <div className="mission-complete" role="status" aria-live="polite">
    <div className="mission-complete-card">
      <div className="mission-complete-burst" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} style={{ "--spark": index } as React.CSSProperties} />)}
      </div>
      <span className="experience-eyebrow">UN PASO MÁS EN TU HISTORIA</span>
      <div className="achievement-medal" aria-hidden="true">
        <svg viewBox="0 0 120 120"><defs><linearGradient id="medal-gold" x2="1" y2="1"><stop stopColor="#fff0ba"/><stop offset="1" stopColor="#b48031"/></linearGradient></defs><path d="m33 76-8 37 24-13 11 13 7-35M87 76l8 37-24-13-11 13-7-35" fill="#377965"/><circle cx="60" cy="52" r="43" fill="url(#medal-gold)"/><circle cx="60" cy="52" r="34" fill="none" stroke="#876125" strokeWidth="1"/><path d="m42 51 12 12 25-27" fill="none" stroke="#294e3d" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
      <h2>{title}</h2>
      <p>{label}</p>
      <small>Tu esfuerzo hace crecer este lugar.</small>
      <div className="achievement-timer" aria-hidden="true" />
    </div>
  </div>;
}
