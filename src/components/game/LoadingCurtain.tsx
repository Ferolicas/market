"use client";

/**
 * Vertical, premium opening card: the storefront under a warm spotlight, the
 * shop name and a progress rail. Replaces the flat emoji placeholder that
 * greeted every load.
 */
export function LoadingCurtain({ title, detail, progress }: { title: string; detail: string; progress?: number }) {
  const value = progress === undefined ? undefined : Math.max(0, Math.min(100, Math.round(progress)));
  return <div className="loading-curtain" role="status" aria-live="polite">
    <div className="loading-card">
      <span className="experience-eyebrow">MINI MARKET · TU HISTORIA EMPIEZA AQUÍ</span>
      <div className="loading-art" aria-hidden="true">
        <div className="market-orbit orbit-one" /><div className="market-orbit orbit-two" />
        <span className="loading-glow" />
        <svg viewBox="0 0 140 120" className="loading-store">
          <defs>
            <linearGradient id="loading-awning" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3f7b5c" />
              <stop offset="100%" stopColor="#2c5b43" />
            </linearGradient>
            <linearGradient id="loading-facade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f6efe0" />
              <stop offset="100%" stopColor="#e2d7c2" />
            </linearGradient>
          </defs>
          <ellipse cx="70" cy="108" rx="52" ry="8" fill="#000" opacity="0.14" />
          <rect x="22" y="40" width="96" height="66" rx="6" fill="url(#loading-facade)" />
          <rect x="22" y="32" width="96" height="14" rx="4" fill="url(#loading-awning)" />
          <rect x="30" y="56" width="34" height="34" rx="3" fill="#bcd8e4" opacity="0.85" />
          <rect x="72" y="56" width="16" height="34" rx="2" fill="#8fb39c" />
          <rect x="92" y="56" width="18" height="34" rx="2" fill="#c8b48c" />
          <rect x="30" y="94" width="80" height="4" rx="2" fill="#cbbfa6" />
          <g className="loading-crates">
            <rect x="96" y="76" width="18" height="14" rx="2" fill="#6f9c5a" />
            <rect x="98" y="66" width="14" height="10" rx="2" fill="#87b06c" />
          </g>
        </svg>
      </div>
      <h1 className="loading-brand">Pequeña tienda.<br /><em>Grandes sueños.</em></h1>
      <strong>{title}</strong>
      <span>{detail}</span>
      <div className="loading-rail" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <i className={value === undefined ? "indeterminate" : ""} style={value === undefined ? undefined : { width: `${value}%` }} />
      </div>
      <div className="loading-footer"><span>DE LA GRANJA A TU BARRIO</span><b>{value === undefined ? "PREPARANDO" : `${value} %`}</b></div>
    </div>
  </div>;
}
