"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import type { AvatarHatId, CharacterId, HairId } from "@/game/types";
import { CharacterHair, CharacterHat } from "./CharacterAccessories";
import { locomotionGroundingSupport, LocomotionController } from "@/game/animation/LocomotionController";
import { FacialController, type FaceExpression } from "@/game/animation/FacialController";
import { feedbackBus, type FeedbackSource } from "@/game/feedback/FeedbackBus";
import { FootGroundingController } from "@/game/animation/FootGroundingController";
import { CHARACTER_FACE_UPDATE_INTERVAL, characterIsInView, characterModelPathForTier, createCharacterVisibilityScratch, disposeCharacterMaterials, prepareCharacterModel, priorityCustomerModelPathsForTier, scheduleCharacterModelPreload, useCharacterModelTier } from "@/game/animation/CharacterPresentation";
import { CHARACTER_PALM_OFFSETS, composeCarryAnimations, createCarrySocketScratch, handPalmPoint, HARVEST_BASKET_GRIP_HALF_WIDTH, HARVEST_BASKET_GRIP_HEIGHT, HARVEST_BASKET_GRIP_REACH, mountedHarvestBasketHandle, placeCarrySocket, updateHarvestBasketHandle } from "@/game/animation/CarrySocket";
import { marketQaQueryEnabled } from "@/game/debug/QaAccess";

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
  carryAccessory?: ReactNode;
  feedbackSource?: FeedbackSource;
  feedbackActorId?: string;
}

export type CharacterAnimation = "Idle" | "Walk" | "Run" | "TurnLeft" | "TurnRight" | "CarryIdle" | "CarryWalk" | "CarryRun" | "Enter" | "Wave" | "ReceiveOrder" | "LiftBox" | "CarryBox" | "PickupLow" | "StockLow" | "StockHigh" | "ScanItem" | "Pay" | "Plant" | "Harvest" | "Happy" | "Confused" | "Talk";

const MODEL_PATHS: Record<CharacterId, string> = {
  "adult-man": "/models/market/characters/owner_man.glb",
  "adult-woman": "/models/market/characters/owner_woman.glb",
  boy: "/models/market/characters/owner_boy.glb",
  girl: "/models/market/characters/owner_girl.glb",
};

const LOD1_MODEL_PATHS = Object.fromEntries(
  Object.entries(MODEL_PATHS).map(([body, path]) => [body, characterModelPathForTier(path, 1)]),
) as Record<CharacterId, string>;
const LOD2_MODEL_PATHS = Object.fromEntries(
  Object.entries(MODEL_PATHS).map(([body, path]) => [body, characterModelPathForTier(path, 2)]),
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
  carryAccessory,
  feedbackSource,
  feedbackActorId,
}: AvatarProps) {
  const avatarRoot = useRef<THREE.Group>(null);
  const groundingRoot = useRef<THREE.Group>(null);
  const appearanceRoot = useRef<THREE.Group>(null);
  const carrySocket = useRef<THREE.Group>(null);
  const carryHandle = useRef<THREE.Object3D | null>(null);
  const relativeHeadMatrix = useRef(new THREE.Matrix4());
  const locomotion = useRef(new LocomotionController());
  const facial = useRef(new FacialController(({ "adult-man": 1, "adult-woman": 2, boy: 3, girl: 4 } as const)[body]));
  const footGrounding = useRef(new FootGroundingController());
  const footWorldPosition = useRef(new THREE.Vector3());
  const avatarWorldScale = useRef(new THREE.Vector3());
  const leftHandWorld = useRef(new THREE.Vector3());
  const rightHandWorld = useRef(new THREE.Vector3());
  const leftPalmWorld = useRef(new THREE.Vector3());
  const rightPalmWorld = useRef(new THREE.Vector3());
  const leftPalmLocal = useRef(new THREE.Vector3());
  const rightPalmLocal = useRef(new THREE.Vector3());
  const leftGripWorld = useRef(new THREE.Vector3());
  const rightGripWorld = useRef(new THREE.Vector3());
  const carryScratch = useMemo(() => createCarrySocketScratch(), []);
  const visibilityScratch = useMemo(() => createCharacterVisibilityScratch(), []);
  const lastFacialUpdate = useRef(Number.NEGATIVE_INFINITY);
  const modelTier = useCharacterModelTier();
  const modelPath = modelTier === 2 ? LOD2_MODEL_PATHS[body] : modelTier === 1 ? LOD1_MODEL_PATHS[body] : MODEL_PATHS[body];
  const gltf = useGLTF(modelPath);
  const model = useMemo(
    () => prepareCharacterModel(gltf.scene, { build: body === "boy" || body === "girl" ? "child" : "adult", reducedDetail: modelTier > 0 }),
    [body, gltf.scene, modelTier],
  );
  const animations = useMemo(() => composeCarryAnimations(gltf.animations), [gltf.animations]);
  const { actions, mixer } = useAnimations(animations, model);
  const mixerRef = useRef(mixer);
  const fallbackClip: CharacterAnimation = animation ?? (walking ? carrying ? "CarryWalk" : "Walk" : carrying ? "CarryIdle" : "Idle");
  const head = model.getObjectByName("Head");
  const leftHand = model.getObjectByName("Hand_L");
  const rightHand = model.getObjectByName("Hand_R");
  const hasCarryAccessory = carrying && Boolean(carryAccessory);
  const feet = useMemo(() => [model.getObjectByName("Foot_L"), model.getObjectByName("Foot_R")].filter((foot): foot is THREE.Object3D => Boolean(foot)), [model]);
  const morphMeshes = useMemo(() => {
    const meshes: THREE.Mesh[] = [];
    model.traverse((object) => {
      if (object instanceof THREE.Mesh && object.morphTargetDictionary && object.morphTargetInfluences) meshes.push(object);
    });
    return meshes;
  }, [model]);

  useFrame(({ camera, clock }) => {
    const liveClip: CharacterAnimation = animation ?? locomotion.current.select(motion?.current.locomotionSpeed ?? motion?.current.speed ?? (walking ? 2.2 : 0), motion?.current.yawDelta ?? 0, carrying);
    const strideWorld = 0.72 * scale * BODY_SCALE[body];
    const gaitScale = motion?.current.speed && ["Walk", "CarryWalk", "Run", "CarryRun"].includes(liveClip) ? THREE.MathUtils.clamp(motion.current.speed / Math.max(0.1, strideWorld), 0.72, 2.8) : animationSpeed ?? (liveClip === "Walk" || liveClip === "CarryWalk" ? 1.3 : liveClip === "Run" || liveClip === "CarryRun" ? 1.4 : 1);
    locomotion.current.transition(actions, liveClip, gaitScale);
    const inView = !avatarRoot.current || characterIsInView(camera, avatarRoot.current, visibilityScratch);
    mixerRef.current.timeScale = inView ? 1 : 0;
    if (!inView) return;
    if (avatarRoot.current && groundingRoot.current && feet.length) {
      let lowest = Number.POSITIVE_INFINITY;
      for (const foot of feet) lowest = Math.min(lowest, foot.getWorldPosition(footWorldPosition.current).y);
      footGrounding.current.calibrate(lowest, 0);
      const support = locomotionGroundingSupport(liveClip);
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
    if (hasCarryAccessory && avatarRoot.current && carrySocket.current && leftHand && rightHand) {
      avatarRoot.current.updateWorldMatrix(true, true);
      leftHand.getWorldPosition(leftHandWorld.current);
      rightHand.getWorldPosition(rightHandWorld.current);
      handPalmPoint(leftHand, CHARACTER_PALM_OFFSETS[body].left, leftPalmWorld.current);
      handPalmPoint(rightHand, CHARACTER_PALM_OFFSETS[body].right, rightPalmWorld.current);
      leftPalmLocal.current.copy(leftPalmWorld.current);
      rightPalmLocal.current.copy(rightPalmWorld.current);
      avatarRoot.current.worldToLocal(leftPalmLocal.current);
      avatarRoot.current.worldToLocal(rightPalmLocal.current);

      const handleScale = placeCarrySocket(
        carrySocket.current,
        leftPalmLocal.current,
        rightPalmLocal.current,
        carryScratch,
      );
      // React can unmount an empty basket and later mount a new one under the
      // same socket. A detached handle still has its old basket as `parent`, so
      // resolve the current descendant instead of trusting parent truthiness.
      const mountedHandle = mountedHarvestBasketHandle(carrySocket.current);
      if (carryHandle.current !== mountedHandle) carryHandle.current = mountedHandle;
      if (carryHandle.current) updateHarvestBasketHandle(carryHandle.current, handleScale, carryScratch);

      // Debug QA records the real animated palms and the rendered handle ends,
      // not synthetic fixture coordinates. This remains inert outside ?debug=1.
      if (feedbackActorId === "player" && typeof window !== "undefined" && marketQaQueryEnabled(window.location.search)) {
        carrySocket.current.updateWorldMatrix(true, true);
        carrySocket.current.localToWorld(leftGripWorld.current.set(-HARVEST_BASKET_GRIP_HALF_WIDTH * handleScale, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH));
        carrySocket.current.localToWorld(rightGripWorld.current.set(HARVEST_BASKET_GRIP_HALF_WIDTH * handleScale, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH));
        const rootScale = Math.max(1e-5, avatarRoot.current.getWorldScale(avatarWorldScale.current).x);
        const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
        qaWindow.__MARKET_QA__ ??= {};
        qaWindow.__MARKET_QA__.carryGrip = {
          clip: liveClip,
          handleScale,
          leftPalmToGrip: leftPalmWorld.current.distanceTo(leftGripWorld.current) / rootScale,
          rightPalmToGrip: rightPalmWorld.current.distanceTo(rightGripWorld.current) / rootScale,
          leftWristToGrip: leftHandWorld.current.distanceTo(leftGripWorld.current) / rootScale,
          rightWristToGrip: rightHandWorld.current.distanceTo(rightGripWorld.current) / rootScale,
        };
      }
    }

    if (clock.elapsedTime - lastFacialUpdate.current >= CHARACTER_FACE_UPDATE_INTERVAL || clock.elapsedTime < lastFacialUpdate.current) {
      lastFacialUpdate.current = clock.elapsedTime;
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
    }
    if (feedbackSource && ["Walk", "Run", "CarryWalk", "CarryRun"].includes(liveClip)) {
      for (const event of locomotion.current.footEvents(actions[liveClip])) {
        void event;
        feedbackBus.emit("footstep", { source: feedbackSource, actorId: feedbackActorId });
      }
    }
  });

  useEffect(() => {
    mixerRef.current = mixer;
  }, [mixer]);

  useEffect(() => {
    scheduleCharacterModelPreload(priorityCustomerModelPathsForTier(modelTier), (path) => useGLTF.preload(path));
  }, [modelTier]);

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

  useEffect(() => () => disposeCharacterMaterials(model), [model]);

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
      {hasCarryAccessory && <group ref={carrySocket} name="CarrySocket" position={[0, 0.64, 0.46]}>{carryAccessory}</group>}
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
