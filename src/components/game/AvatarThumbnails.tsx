"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { createContext, memo, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { AvatarConfig } from "@/game/types";
import { Avatar } from "./Avatar";
import { safeCanvasEvents } from "./safeCanvasEvents";

export interface ThumbnailRequest {
  id: string;
  avatar: AvatarConfig;
  /** A head shot for hairstyles, the whole body for characters. */
  framing: "head" | "body";
}

interface GalleryValue {
  images: Record<string, string>;
  request: (requests: readonly ThumbnailRequest[]) => void;
}

const GalleryContext = createContext<GalleryValue | null>(null);

const THUMBNAIL_SIZE = 192;

/**
 * Real portraits instead of drawn stand-ins: the same rigged characters and
 * hair the game renders, baked once to an image. Only one avatar is ever in
 * memory at a time, so a wardrobe of twenty options never puts twenty
 * two-hundred-thousand-triangle bodies on the GPU at once.
 */
export function AvatarGallery({ children }: { children: ReactNode }) {
  const [images, setImages] = useState<Record<string, string>>({});
  const [queue, setQueue] = useState<ThumbnailRequest[]>([]);
  const known = useRef(new Set<string>());
  const request = useCallback((requests: readonly ThumbnailRequest[]) => {
    const fresh = requests.filter((candidate) => !known.current.has(candidate.id));
    if (!fresh.length) return;
    for (const candidate of fresh) known.current.add(candidate.id);
    setQueue((current) => [...current, ...fresh]);
  }, []);
  const complete = useCallback((id: string, image: string) => {
    setImages((current) => (current[id] === image ? current : { ...current, [id]: image }));
    setQueue((current) => current.filter((candidate) => candidate.id !== id));
  }, []);
  const value = useMemo(() => ({ images, request }), [images, request]);
  const current = queue[0];
  return <GalleryContext.Provider value={value}>
    {children}
    {current && <div className="avatar-thumbnail-baker" aria-hidden="true">
      <Canvas
        key={current.id}
        events={safeCanvasEvents}
        dpr={1}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "low-power" }}
        camera={{ position: [0, 0.65, 2.4], fov: 32 }}
        style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
      >
        <ambientLight intensity={1.5} />
        <directionalLight position={[2.4, 4, 3]} intensity={2.1} />
        <Suspense fallback={null}>
          <BakeSubject request={current} onComplete={complete} />
          <Environment resolution={32} frames={1} environmentIntensity={0.4}>
            <Lightformer form="rect" intensity={3} color="#fff6e6" position={[0, 4, 2]} rotation={[Math.PI / 2, 0, 0]} scale={[6, 6]} />
          </Environment>
        </Suspense>
      </Canvas>
    </div>}
  </GalleryContext.Provider>;
}

/** Frames the subject from its own Head bone, then captures the canvas. */
function BakeSubject({ request, onComplete }: { request: ThumbnailRequest; onComplete: (id: string, image: string) => void }) {
  const subject = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  const frames = useRef(0);
  const captured = useRef(false);
  useEffect(() => { frames.current = 0; captured.current = false; }, [request.id]);
  useFrame(({ gl, scene }) => {
    if (captured.current || !subject.current) return;
    frames.current += 1;
    if (frames.current === 1) {
      const head = subject.current.getObjectByName("Head");
      const headPoint = new THREE.Vector3();
      if (head) head.getWorldPosition(headPoint);
      else headPoint.set(0, 1, 0);
      if (request.framing === "head") {
        camera.position.set(0, headPoint.y, headPoint.z + 0.72);
        camera.lookAt(0, headPoint.y, headPoint.z);
      } else {
        const centre = headPoint.y * 0.56;
        camera.position.set(0, centre, headPoint.y * 2.6);
        camera.lookAt(0, centre, 0);
      }
      camera.updateProjectionMatrix();
      return;
    }
    if (frames.current < 4) return;
    captured.current = true;
    gl.render(scene, camera);
    onComplete(request.id, gl.domElement.toDataURL("image/png"));
  });
  return <group ref={subject}><Avatar {...request.avatar} animation="Idle" /></group>;
}

/** Requests its portrait once and shows it as soon as the bake finishes. */
export const AvatarThumbnail = memo(function AvatarThumbnail({ request, alt }: { request: ThumbnailRequest; alt: string }) {
  const gallery = useContext(GalleryContext);
  const { id } = request;
  const avatarKey = JSON.stringify(request.avatar);
  useEffect(() => {
    gallery?.request([{ id, avatar: JSON.parse(avatarKey) as AvatarConfig, framing: request.framing }]);
  }, [gallery, id, avatarKey, request.framing]);
  const image = gallery?.images[id];
  return image
    // eslint-disable-next-line @next/next/no-img-element -- a baked data: URL, not a network asset next/image can optimize
    ? <img className="avatar-thumbnail" src={image} alt={alt} width={THUMBNAIL_SIZE} height={THUMBNAIL_SIZE} />
    : <span className="avatar-thumbnail pending" aria-hidden="true" />;
});
