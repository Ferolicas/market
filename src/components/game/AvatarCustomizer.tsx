"use client";

import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import { CHARACTERS, HAIRSTYLES, HATS } from "@/game/catalog";
import type { AvatarConfig, AvatarHatId } from "@/game/types";
import { Avatar } from "./Avatar";
import { safeCanvasEvents } from "./safeCanvasEvents";

export function AvatarCustomizer({ avatar, onChange, compact = false }: { avatar: AvatarConfig; onChange: (change: Partial<AvatarConfig>) => void; compact?: boolean }) {
  return <div className={`avatar-customizer ${compact ? "compact" : ""}`}>
    <div className="avatar-preview-3d" aria-label="Vista previa tridimensional del personaje">
      <Canvas events={safeCanvasEvents} shadows="percentage" dpr={[1, 1.5]} camera={{ position: [0, 1.42, 6.3], fov: 34 }} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
        <ambientLight intensity={1.45} />
        <directionalLight position={[3, 5, 4]} intensity={2.2} castShadow />
        <Suspense fallback={null}>
          <Avatar {...avatar} />
          <Environment preset="studio" environmentIntensity={0.42} />
        </Suspense>
        <ContactShadows position={[0, 0.01, 0]} opacity={0.34} scale={3.5} blur={2.4} far={3} />
        <OrbitControls target={[0, 1.12, 0]} enablePan={false} enableZoom={false} minPolarAngle={Math.PI / 2.5} maxPolarAngle={Math.PI / 1.85} />
      </Canvas>
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
          {HAIRSTYLES.map((style, index) => <button key={style.id} type="button" className={avatar.hair === style.id ? "selected" : ""} aria-pressed={avatar.hair === style.id} title={style.name} onClick={() => onChange({ hair: style.id })}>
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

function CustomizerSection({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return <section className="customizer-section"><header><strong>{title}</strong><small>{note}</small></header>{children}</section>;
}

function HatButton({ id, name, emoji, selected, onSelect }: { id: AvatarHatId; name: string; emoji: string; selected: boolean; onSelect: (id: AvatarHatId) => void }) {
  return <button type="button" className={selected ? "selected" : ""} aria-pressed={selected} title={name} onClick={() => onSelect(id)}><span>{emoji}</span><small>{name}</small></button>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span>{label}</span><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /><b style={{ background: value }} /></label>;
}
