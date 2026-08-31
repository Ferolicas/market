"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AvatarHatId, CharacterId, HairId } from "@/game/types";
import { CharacterHair, CharacterHat } from "./CharacterAccessories";
import { LocomotionController } from "@/game/animation/LocomotionController";
import { FacialController, type FaceExpression } from "@/game/animation/FacialController";
import { feedbackBus, type FeedbackSource } from "@/game/feedback/FeedbackBus";
import { FootGroundingController } from "@/game/animation/FootGroundingController";

interface AvatarProps {
  skin: string;
  shirt: string;
  hat: AvatarHatId;
  body?: CharacterId;
  hair?: HairId;
  hairColor?: string;
  walking?: boolean;
  carrying?: boolean;
  motion?: RefObject<{ speed: number; locomotionSpeed?: number; yawDelta: number }>;
  animation?: CharacterAnimation;
  animationSpeed?: number;
  scale?: number;
  feedbackSource?: FeedbackSource;
  feedbackActorId?: string;
}

export type CharacterAnimation = "Idle" | "Walk" | "Run" | "TurnLeft" | "TurnRight" | "CarryIdle" | "CarryWalk" | "Enter" | "Wave" | "ReceiveOrder" | "LiftBox" | "CarryBox" | "PickupLow" | "StockLow" | "StockHigh" | "ScanItem" | "Pay" | "Plant" | "Harvest" | "Happy" | "Confused" | "Talk";

const MODEL_PATHS: Record<CharacterId, string> = {
  "adult-man": "/models/market/characters/owner_man.glb",
  "adult-woman": "/models/market/characters/owner_woman.glb",
  boy: "/models/market/characters/owner_boy.glb",
  girl: "/models/market/characters/owner_girl.glb",
};

const LOD1_MODEL_PATHS = Object.fromEntries(
  Object.entries(MODEL_PATHS).map(([body, path]) => [body, path.replace("/characters/", "/characters/lod1/")]),
) as Record<CharacterId, string>;

const BODY_SCALE: Record<CharacterId, number> = {
  "adult-man": 1.32,
  "adult-woman": 1.36,
  boy: 1.38,
  girl: 1.32,
};

export function Avatar(props: AvatarProps) {
  const body = props.body ?? "adult-man";
  return <RiggedAvatar key={body} {...props} body={body} />;
}

function RiggedAvatar({
  skin,
  shirt,
  hat,
  body = "adult-man",
  hair = "side-part",
  hairColor = "#332b27",
  walking = false,
  carrying = false,
  motion,
  animation,
  animationSpeed,
  scale = 1,
  feedbackSource,
  feedbackActorId,
}: AvatarProps) {
  const avatarRoot = useRef<THREE.Group>(null);
  const groundingRoot = useRef<THREE.Group>(null);
  const appearanceRoot = useRef<THREE.Group>(null);
  const relativeHeadMatrix = useRef(new THREE.Matrix4());
  const locomotion = useRef(new LocomotionController());
  const facial = useRef(new FacialController(({ "adult-man": 1, "adult-woman": 2, boy: 3, girl: 4 } as const)[body]));
  const footGrounding = useRef(new FootGroundingController());
  const footWorldPosition = useRef(new THREE.Vector3());
  const avatarWorldScale = useRef(new THREE.Vector3());
  const [compactModel] = useState(() => typeof window !== "undefined" && window.innerWidth <= 640);
  const gltf = useGLTF(compactModel ? LOD1_MODEL_PATHS[body] : MODEL_PATHS[body]);
  const model = useMemo(() => {
    const copy = clone(gltf.scene) as THREE.Group;
    copy.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material.clone())
        : object.material.clone();
    });
    return copy;
  }, [gltf.scene]);
  const { actions } = useAnimations(gltf.animations, model);
  const fallbackClip: CharacterAnimation = animation ?? (walking ? carrying ? "CarryWalk" : "Walk" : carrying ? "CarryIdle" : "Idle");
  const head = model.getObjectByName("Head");
  const feet = useMemo(() => [model.getObjectByName("Foot_L"), model.getObjectByName("Foot_R")].filter((foot): foot is THREE.Object3D => Boolean(foot)), [model]);
  const morphMeshes = useMemo(() => {
    const meshes: THREE.Mesh[] = [];
    model.traverse((object) => {
      if (object instanceof THREE.Mesh && object.morphTargetDictionary && object.morphTargetInfluences) meshes.push(object);
    });
    return meshes;
  }, [model]);

  useFrame(({ clock }) => {
    const liveClip: CharacterAnimation = animation ?? locomotion.current.select(motion?.current.locomotionSpeed ?? motion?.current.speed ?? (walking ? 2.2 : 0), motion?.current.yawDelta ?? 0, carrying);
    const strideWorld = 0.72 * scale * BODY_SCALE[body];
    const gaitScale = motion?.current.speed && ["Walk", "CarryWalk", "Run"].includes(liveClip) ? THREE.MathUtils.clamp(motion.current.speed / Math.max(0.1, strideWorld), 0.72, 2.8) : animationSpeed ?? (liveClip === "Walk" || liveClip === "CarryWalk" ? 1.3 : liveClip === "Run" ? 1.4 : 1);
    locomotion.current.transition(actions, liveClip, gaitScale);
    if (avatarRoot.current && groundingRoot.current && feet.length) {
      let lowest = Number.POSITIVE_INFINITY;
      for (const foot of feet) lowest = Math.min(lowest, foot.getWorldPosition(footWorldPosition.current).y);
      footGrounding.current.calibrate(lowest, 0);
      const support = ["Walk", "CarryWalk", "Run", "TurnLeft", "TurnRight"].includes(liveClip) ? 1 : 0.25;
      const correctionWorld = footGrounding.current.solve(lowest, 0, support);
      const rootScale = avatarRoot.current.getWorldScale(avatarWorldScale.current).y;
      groundingRoot.current.position.y = THREE.MathUtils.lerp(groundingRoot.current.position.y, correctionWorld / Math.max(0.001, rootScale), 0.24);
    }
    if (avatarRoot.current && appearanceRoot.current && head) {
      avatarRoot.current.updateWorldMatrix(true, false);
      head.updateWorldMatrix(true, false);
      relativeHeadMatrix.current.copy(avatarRoot.current.matrixWorld).invert().multiply(head.matrixWorld);
      appearanceRoot.current.matrix.copy(relativeHeadMatrix.current);
      appearanceRoot.current.matrixWorldNeedsUpdate = true;
    }

    const expression: FaceExpression = liveClip === "Happy" ? "Happy" : liveClip === "Confused" ? "Confused" : "Neutral";
    const weights = facial.current.weights(clock.elapsedTime, expression);
    const talk = liveClip === "Talk" ? Math.max(0, Math.sin(clock.elapsedTime * 10)) * 0.42 : 0;
    for (const mesh of morphMeshes) {
      const dictionary = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dictionary || !influences) continue;
      for (const name of ["Blink_L", "Blink_R", "EyeWide_L", "EyeWide_R", "BrowUp_L", "BrowUp_R", "BrowDown_L", "BrowDown_R", "Smile", "CheekUp", "Frown", "JawOpen", "MouthNarrow", "Surprise", "Confused"]) setMorph(dictionary, influences, name, weights[name] ?? 0);
      setMorph(dictionary, influences, "MouthOpen", talk);
    }
    if (feedbackSource && ["Walk", "Run", "CarryWalk"].includes(liveClip)) {
      for (const event of locomotion.current.footEvents(actions[liveClip])) {
        void event;
        feedbackBus.emit("footstep", { source: feedbackSource, actorId: feedbackActorId });
      }
    }
  });

  useEffect(() => {
    locomotion.current.transition(actions, fallbackClip, animationSpeed ?? 1);
    return () => { actions[fallbackClip]?.fadeOut(0.16); };
  }, [actions, animationSpeed, fallbackClip]);

  useEffect(() => {
    const skinColor = new THREE.Color(skin);
    const shirtColor = new THREE.Color(shirt);
    const hairTint = new THREE.Color(hairColor);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        const name = material.name.toLowerCase();
        if (name === "skin" || name === "skinblush") material.color.copy(skinColor);
        if (name === "shirt") material.color.copy(shirtColor);
        if (name === "secondarycloth") material.color.copy(shirtColor).multiplyScalar(0.78);
        if (name.includes("hair")) material.color.copy(hairTint);
      }
    });
  }, [hairColor, model, shirt, skin]);

  useEffect(() => () => {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }, [model]);

  return (
    <group ref={avatarRoot} scale={scale * BODY_SCALE[body]}>
      <GroundingShadow />
      <group ref={groundingRoot}><primitive object={model} dispose={null} /></group>
      {head && <group ref={appearanceRoot} matrixAutoUpdate={false}>
        <Suspense fallback={null}>
          {hat === "none" && <CharacterHair key={`${body}-hair-${hair}`} body={body} style={hair} color={hairColor} />}
          {hat !== "none" && <CharacterHat key={`${body}-hat-${hat}`} body={body} hat={hat} />}
        </Suspense>
      </group>}
    </group>
  );
}

function setMorph(dictionary: Record<string, number>, influences: number[], name: string, value: number) {
  const index = dictionary[name];
  if (index !== undefined) influences[index] = value;
}

function GroundingShadow() {
  return <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.6, 0.35, 1]} renderOrder={-1}>
    <circleGeometry args={[1, 24]} />
    <meshBasicMaterial color="#15251f" transparent opacity={0.2} depthWrite={false} />
  </mesh>;
}
