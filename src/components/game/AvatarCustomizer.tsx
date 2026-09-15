"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Component, Suspense, useEffect, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { CHARACTERS, HAIRSTYLES, HATS } from "@/game/catalog";
import type { AvatarConfig, AvatarHatId } from "@/game/types";
import { Avatar } from "./Avatar";
import { safeCanvasEvents } from "./safeCanvasEvents";

export function AvatarCustomizer({ avatar, onChange, compact = false }: { avatar: AvatarConfig; onChange: (change: Partial<AvatarConfig>) => void; compact?: boolean }) {
  return <div className={`avatar-customizer ${compact ? "compact" : ""}`}>
    <div className="avatar-preview-3d" aria-label="Vista previa tridimensional del personaje">
      <PreviewErrorBoundary>
        <Canvas events={safeCanvasEvents} shadows="percentage" dpr={[1, 1.5]} camera={{ position: [0, 0.72, 2.9], fov: 34 }} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
          <PreviewFraming />
          <ambientLight intensity={1.45} />
          <directionalLight position={[3, 5, 4]} intensity={2.2} castShadow />
          <Suspense fallback={null}>
            <Avatar {...avatar} />
            <StudioEnvironment />
          </Suspense>
          <ContactShadows position={[0, 0.01, 0]} opacity={0.34} scale={3.5} blur={2.4} far={3} />
          <OrbitControls target={[0, 0.55, 0]} enablePan={false} enableZoom={false} minPolarAngle={Math.PI / 2.5} maxPolarAngle={Math.PI / 1.85} />
        </Canvas>
      </PreviewErrorBoundary>
      <span className="preview-hint">Arrastra para verlo en 360°</span>
    </div>

    <div className="avatar-options">
      <CustomizerSection title="Personaje" note="Puedes cambiarlo siempre">
        <div className="character-options">
          {CHARACTERS.map((character) => <button key={character.id} type="button" className={avatar.body === character.id ? "selected" : ""} aria-pressed={avatar.body === character.id} onClick={() => onChange({ body: character.id })}>
            <span className={`character-silhouette ${character.id}`}><i /><b /></span>
            <strong>{character.name}</strong><small>{character.description}</small>
          </button>)}
        </div>
      </CustomizerSection>

      <CustomizerSection title="Peinado" note={`${HAIRSTYLES.length} estilos`}>
        <div className="hair-options">
          {HAIRSTYLES.map((style, index) => <button key={style.id} type="button" className={avatar.hair === style.id ? "selected" : ""} aria-pressed={avatar.hair === style.id} title={style.name} onClick={() => onChange({ hair: style.id, hat: "none" })}>
            <span className={`hair-thumbnail hair-${(index % 6) + 1}`} style={{ "--hair-preview": avatar.hairColor } as CSSProperties} />
            <small>{style.name}</small>
          </button>)}
        </div>
      </CustomizerSection>

      <CustomizerSection title="Gorro de animal" note="Opcional">
        <div className="animal-hat-options">
          <HatButton id="none" name="Sin gorro" emoji="—" selected={avatar.hat === "none"} onSelect={(hat) => onChange({ hat })} />
          {HATS.map((hat) => <HatButton key={hat.id} id={hat.id} name={hat.name} emoji={hat.emoji} selected={avatar.hat === hat.id} onSelect={(id) => onChange({ hat: id })} />)}
        </div>
      </CustomizerSection>

      <CustomizerSection title="Colores" note="Tu estilo">
        <div className="avatar-color-options">
          <ColorField label="Piel" value={avatar.skin} onChange={(skin) => onChange({ skin })} />
          <ColorField label="Pelo" value={avatar.hairColor} onChange={(hairColor) => onChange({ hairColor })} />
          <ColorField label="Camisa" value={avatar.shirt} onChange={(shirt) => onChange({ shirt })} />
        </div>
      </CustomizerSection>
    </div>
  </div>;
}

/**
 * Self-contained studio lighting. The former `preset="studio"` fetched an HDR
 * from a public CDN; the production CSP (`connect-src 'self' blob:`) blocks
 * that request, the loader rejects inside Suspense and, without a boundary,
 * React unmounted the entire game the moment the avatar panel opened.
 */
function PreviewFraming() {
  const camera = useThree(state => state.camera);
  const size = useThree(state => state.size);
  useEffect(() => {
    // Fit both the tall desktop column and the wide mobile preview. Include
    // clearance for the approved animal hoods without rescaling the avatar.
    const verticalSpan = Math.max(1.9, 0.85 / Math.max(0.2, size.width / size.height));
    const distance = verticalSpan / (2 * Math.tan(34 * Math.PI / 360));
    camera.position.set(0, 0.65, distance);
    camera.lookAt(0, 0.55, 0);
  }, [camera, size.width, size.height]);
  return null;
}

function StudioEnvironment() {
  return <Environment resolution={64} frames={1} environmentIntensity={0.42}>
    <Lightformer form="rect" intensity={3.2} color="#fff6e6" position={[0, 4.5, 2]} rotation={[Math.PI / 2, 0, 0]} scale={[6, 6]} />
    <Lightformer form="rect" intensity={1.6} color="#dfe9ff" position={[4, 2, 2]} rotation={[0, -Math.PI / 2, 0]} scale={[4, 3]} />
    <Lightformer form="rect" intensity={1.2} color="#ffe6cf" position={[-4, 2, 1]} rotation={[0, Math.PI / 2, 0]} scale={[4, 3]} />
    <Lightformer form="rect" intensity={0.8} color="#cfd8d3" position={[0, 1.5, -4]} rotation={[0, Math.PI, 0]} scale={[6, 3]} />
  </Environment>;
}

/** A failed preview asset must never take the game down with it. */
class PreviewErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Avatar preview failed", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return <div className="avatar-preview-fallback" role="status">La vista previa no está disponible en este dispositivo. Tus cambios se aplican igualmente.</div>;
    }
    return this.props.children;
  }
}

function CustomizerSection({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return <section className="customizer-section"><header><strong>{title}</strong><small>{note}</small></header>{children}</section>;
}

function HatButton({ id, name, emoji, selected, onSelect }: { id: AvatarHatId; name: string; emoji: string; selected: boolean; onSelect: (id: AvatarHatId) => void }) {
  return <button type="button" className={selected ? "selected" : ""} aria-pressed={selected} title={name} onClick={() => onSelect(id)}><span>{emoji}</span><small>{name}</small></button>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span>{label}</span><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /><b style={{ background: value }} /></label>;
}
