"use client";

import { useEffect, useMemo, useRef } from "react";

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
  const letters = useMemo(() => [...title], [title]);
  return <div className="mission-complete" role="status" aria-live="polite">
    <div className="mission-complete-card">
      <div className="mission-complete-burst" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} style={{ "--spark": index } as React.CSSProperties} />)}
      </div>
      <div className="mission-complete-crate" aria-hidden="true">
        <svg viewBox="0 0 120 110">
          <ellipse cx="60" cy="98" rx="42" ry="7" fill="#000" opacity="0.16" />
          <path d="M18 46h84l-6 48H24Z" fill="#b98b57" />
          <path d="M18 46h84l4-12H14Z" fill="#cfa06a" />
          <rect x="30" y="58" width="60" height="6" rx="3" fill="#a5794a" />
          <circle cx="44" cy="40" r="13" fill="#d8503f" />
          <circle cx="62" cy="34" r="15" fill="#e15c48" />
          <circle cx="80" cy="41" r="12" fill="#c9442f" />
          <path d="M60 22c6-8 14-10 20-9-2 7-8 12-16 13Z" fill="#4f8f4b" />
        </svg>
      </div>
      <h2 aria-label={title}>
        {letters.map((letter, index) => <span key={`${letter}-${index}`} style={{ animationDelay: `${index * 45}ms` }}>{letter === " " ? " " : letter}</span>)}
      </h2>
      <p>{label}</p>
      <small>¡Felicitaciones!</small>
    </div>
  </div>;
}
