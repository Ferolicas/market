"use client";

import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { CharacterId, CustomerRuntimeState, Employee, HatId } from "@/game/types";
import { InstanceRegistry, PartsInstancer } from "@/game/render/CrowdParts";
import { loadCrowdAnimation, type CrowdAnimationSet } from "@/game/render/CrowdSkinning";
import { accessoryModelPathForTier, characterModelPathForTier, prepareCharacterModel, useCharacterModelTier } from "@/game/animation/CharacterPresentation";
import { type BodyRegistry, CrowdCustomersSystem, CrowdEmployeesSystem, CUSTOMER_BODY_KEYS, CUSTOMER_PROP_DEFINITIONS, EMPLOYEE_BODY_KEYS, EMPLOYEE_PROP_DEFINITIONS, HAT_FILES, type PartsRegistry, PRODUCT_CAPACITY, PROP_CAPACITY, createCrowdBody, createPropInstancers, deliveredIdsIn, employeeBodyOf, firstSkinnedMesh } from "@/game/render/CrowdSystems";
import { deliveredModelPath } from "./DeliveredModel";
import { accessoryParts, deliveredProductParts } from "./CrowdProps";

/**
 * React bindings of the crowd systems for the R3F scene: components load
 * the GLBs through drei's cache and register bodies, hats and delivered
 * product parts into a system; one `useFrame` per system runs its update.
 * See `src/game/render/CrowdSystems.ts` for the rendering itself.
 */
function CrowdBodyBatch({ bodyKey, modelPath, registry, parent, warm }: { bodyKey: string; modelPath: string; registry: BodyRegistry; parent: THREE.Object3D | null; warm?: readonly [number, number, number] }) {
  const gltf = useGLTF(modelPath);
  const [animation, setAnimation] = useState<CrowdAnimationSet | null>(null);
  useEffect(() => {
    let alive = true;
    loadCrowdAnimation(bodyKey).then((set) => { if (alive) setAnimation(set); }).catch((error: unknown) => console.error("crowd animation", bodyKey, error));
    return () => { alive = false; };
  }, [bodyKey]);
  useEffect(() => {
    if (!animation || !parent) return;
    const prepared = prepareCharacterModel(gltf.scene, { crowd: true, reducedDetail: true });
    const skinned = firstSkinnedMesh(prepared);
    if (!skinned) return;
    const body = createCrowdBody(skinned, animation, bodyKey, warm);
    parent.add(body.mesh);
    registry.set(bodyKey, body);
    return () => { registry.delete(bodyKey); body.dispose(); };
  }, [animation, bodyKey, gltf.scene, parent, registry, warm]);
  return null;
}

/**
 * Loads every crowd body of the current tier (six customers, two staff) and
 * draws each once, tiny, inside the opening frustum while the loading cover
 * is up: the GLBs decode, the atlases and bone textures upload and the crowd
 * programs compile before the first shopper walks in. Unmount once the scene
 * has settled.
 */
export function CrowdWarmup({ position }: { position: readonly [number, number, number] }) {
  const tier = useCharacterModelTier();
  const modelTier = tier === 2 ? 2 : 1;
  const registry = useMemo<BodyRegistry>(() => new InstanceRegistry(), []);
  const [parent, setParent] = useState<THREE.Group | null>(null);
  return <group ref={setParent} name="crowd:warmup">
    {Object.values(CUSTOMER_BODY_KEYS).map((key) => <CrowdBodyBatch key={key} bodyKey={key} modelPath={characterModelPathForTier(`/models/market/customers/${key}.glb`, modelTier)} registry={registry} parent={parent} warm={position} />)}
    {Object.values(EMPLOYEE_BODY_KEYS).map((key) => key && <CrowdBodyBatch key={key} bodyKey={key} modelPath={characterModelPathForTier(`/models/market/characters/${key}.glb`, modelTier)} registry={registry} parent={parent} warm={position} />)}
  </group>;
}

/** A delivered SKU's parts, registered once its GLB is in. */
function DeliveredProductBatch({ id, registry, parent }: { id: "milk" | "cheese" | "egg"; registry: PartsRegistry; parent: THREE.Object3D | null }) {
  const { scene } = useGLTF(deliveredModelPath(id));
  const productId = id === "egg" ? "eggs" : id;
  useEffect(() => {
    if (!parent) return;
    const instancer = new PartsInstancer(deliveredProductParts(scene), PRODUCT_CAPACITY, `crowd-product:${productId}`);
    instancer.attach(parent);
    registry.set(productId, instancer);
    return () => { registry.delete(productId); instancer.detach(); instancer.dispose(); };
  }, [parent, productId, registry, scene]);
  return null;
}

/** A hat kind worn by at least one employee, as instanced parts. */
function HatBatch({ hat, body, registry, parent }: { hat: HatId; body: CharacterId; registry: PartsRegistry; parent: THREE.Object3D | null }) {
  const tier = useCharacterModelTier();
  const gltf = useGLTF(accessoryModelPathForTier(`/models/market/hats/${body}/${HAT_FILES[hat]}.glb`, tier));
  const key = `${body}:${hat}`;
  useEffect(() => {
    if (!parent) return;
    const instancer = new PartsInstancer(accessoryParts(gltf.scene), PROP_CAPACITY, `crowd-hat:${key}`);
    instancer.attach(parent);
    registry.set(key, instancer);
    return () => { registry.delete(key); instancer.detach(); instancer.dispose(); };
  }, [gltf.scene, key, parent, registry]);
  return null;
}

export function CrowdCustomers({ customers }: { customers: readonly CustomerRuntimeState[] }) {
  const tier = useCharacterModelTier();
  const system = useMemo(() => new CrowdCustomersSystem(), []);
  const [parent, setParent] = useState<THREE.Group | null>(null);
  const identities = useMemo(() => [...new Set(customers.map((customer) => customer.identity))], [customers]);
  const deliveredIds = useMemo(() => deliveredIdsIn(customers.map((customer) => customer.basket)), [customers]);
  const modelTier = tier === 2 ? 2 : 1;
  useEffect(() => {
    if (!parent) return;
    system.attachTo(parent);
    return createPropInstancers(parent, CUSTOMER_PROP_DEFINITIONS(), system.props);
  }, [parent, system]);
  useEffect(() => { system.setModelTier(modelTier); }, [modelTier, system]);
  useFrame(({ clock, camera }, delta) => system.update(camera, delta, clock.elapsedTime));

  return <group ref={setParent} name="crowd:customers">
    {identities.map((identity) => <CrowdBodyBatch key={identity} bodyKey={CUSTOMER_BODY_KEYS[identity]} modelPath={characterModelPathForTier(`/models/market/customers/${CUSTOMER_BODY_KEYS[identity]}.glb`, modelTier)} registry={system.bodies} parent={parent} />)}
    {deliveredIds.map((id) => <DeliveredProductBatch key={id} id={id} registry={system.delivered} parent={parent} />)}
  </group>;
}

export function CrowdEmployees({ employees }: { employees: readonly Employee[] }) {
  const tier = useCharacterModelTier();
  const system = useMemo(() => new CrowdEmployeesSystem(), []);
  const [parent, setParent] = useState<THREE.Group | null>(null);
  const modelTier = tier === 2 ? 2 : 1;
  const bodyKinds = useMemo(() => [...new Set(employees.map((_, index) => employeeBodyOf(index)))], [employees]);
  const hatKinds = useMemo(() => [...new Set(employees.map((employee, index) => `${employeeBodyOf(index)}:${employee.hat}`))], [employees]);
  const deliveredIds = useMemo(() => deliveredIdsIn(employees.map((employee) => employee.runtime?.carry.items ?? {})), [employees]);
  useEffect(() => {
    if (!parent) return;
    system.attachTo(parent);
    return createPropInstancers(parent, EMPLOYEE_PROP_DEFINITIONS(), system.props);
  }, [parent, system]);
  useEffect(() => { system.setEmployees(employees); }, [employees, system]);
  useFrame(({ camera }, delta) => system.update(camera, delta));

  return <group ref={setParent} name="crowd:employees">
    {bodyKinds.map((bodyId) => <CrowdBodyBatch key={bodyId} bodyKey={EMPLOYEE_BODY_KEYS[bodyId]!} modelPath={characterModelPathForTier(`/models/market/characters/${EMPLOYEE_BODY_KEYS[bodyId]}.glb`, modelTier)} registry={system.bodies} parent={parent} />)}
    {hatKinds.map((key) => { const [bodyId, hat] = key.split(":") as [CharacterId, HatId]; return <HatBatch key={key} hat={hat} body={bodyId} registry={system.hats} parent={parent} />; })}
    {deliveredIds.map((id) => <DeliveredProductBatch key={id} id={id} registry={system.delivered} parent={parent} />)}
  </group>;
}
