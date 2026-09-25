import * as THREE from "three";
import type { CharacterId, CustomerRuntimeState, Employee, EmployeeRole, EmployeeRuntimeState, HatId, ProductId } from "@/game/types";
import { PRODUCT_IDS } from "@/game/economy/ProductRegistry";
import { liveActors } from "@/game/render/LiveActors";
import { InstanceRegistry, PartsInstancer, mergeStaticParts, type InstancedPart } from "@/game/render/CrowdParts";
import { CROWD_INSTANCE_ATTRIBUTE, createCrowdMaterial, createCrowdPoseAttribute, crowdBoneIndex, readCrowdBoneMatrix, type CrowdAnimationSet } from "@/game/render/CrowdSkinning";
import { advanceCrowdPose, createCrowdPose, crowdGaitTimeScale, crowdPoseRows, type CrowdPoseState } from "@/game/render/CrowdPose";
import { crowdCharacterInView, updateCrowdFrustum } from "@/game/render/CrowdCulling";
import type { CrowdClipName } from "@/game/render/CrowdAnimation";
import { CLIP_NATURAL_SPEED, LocomotionController } from "@/game/animation/LocomotionController";
import { captureCustomerMotion, captureEmployeeMotion, projectCustomerMotion, type CustomerMotionSnapshot } from "@/game/animation/CustomerVisualMotion";
import { CUSTOMER_CART_WHEEL_RADIUS, CUSTOMER_PICKUP_DURATION_MS, cartSteeringAngle, checkoutCartInventory, checkoutLoadingPresentation, easedMotionProgress, motionProgress, productTransferPoint, shortestHeadingDelta, wheelRollDelta } from "@/game/animation/CustomerCartMotion";
import { ADULT_CHARACTER_SCENE_SCALE } from "@/game/animation/CharacterScale";
import { CHARACTER_PALM_OFFSETS, HARVEST_BASKET_GRIP_HEIGHT, HARVEST_BASKET_GRIP_REACH } from "@/game/animation/CarrySocket";
import { dampFactor, frameDelta, turnTowards } from "@/game/locomotion";
import { scaleStorePoint, STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE } from "@/game/world-scale";
import { checkoutCustomerFacingYaw, checkoutParkedCart } from "@/game/stations/checkout-layout";
import { PRODUCT_RETAIL_DEPARTMENT, retailDisplayPosition } from "@/game/stations/retail-layout";
import { MARKET_QA_BUILD_ENABLED, marketQaQueryEnabled } from "@/game/debug/QaAccess";
import { carriedProductIds, carryQuantity, carryTotal, MAX_WAREHOUSE_PICKUP_BATCH } from "@/game/player/CarrySystem";
import { deliveredProductId } from "@/components/game/DeliveredModel";
import { CART_BAY_POSITION, CART_HANDLE_BASE_WIDTH, CART_HANDLE_Y, CART_HANDLE_Z, CART_SCALE, CUSTOMER_SCALE, PICKUP_HEIGHT, customerAnimation, productPickupLateralOffset } from "@/components/game/CustomerPresentation";
import { CART_BAG_PARTS, CART_BASKET_SOCKET, CART_CASTER_PART, CART_CASTER_POSITIONS, CART_CHASSIS_PARTS, CART_WHEEL_PART, GROUND_SHADOW_PARTS, HAND_BAG_PARTS, HARVEST_BASKET_PARTS, basketProductParts, cartProductSlot, harvestProductSlot } from "@/components/game/CrowdProps";

/**
 * Crowd rendering without a scene graph per character: every customer and
 * employee body of one kind is a single InstancedMesh skinned in the vertex
 * shader from a baked bone texture, and every prop they carry (carts, wheels,
 * products, bags, baskets, hats) is an instanced part list. Per character
 * and frame the main thread computes a position, a heading, a clip and a
 * couple of socket matrices — no mixers, no bone hierarchies, no draw per
 * character. The React scene and the plain-three client both drive these
 * systems; they only differ in how they load the assets.
 */
export const BODY_CAPACITY = 48;
export const PROP_CAPACITY = 64;
export const PRODUCT_CAPACITY = 320;

export type CustomerIdentity = CustomerRuntimeState["identity"];
export const CUSTOMER_BODY_KEYS: Record<CustomerIdentity, string> = {
  1: "customer_01_man_young", 2: "customer_02_man_senior", 3: "customer_03_woman_young",
  4: "customer_04_woman_adult", 5: "customer_05_woman_mature", 6: "customer_06_woman_senior",
};
export const EMPLOYEE_BODIES: CharacterId[] = ["adult-woman", "adult-man", "adult-woman", "adult-man"];
export const EMPLOYEE_BODY_KEYS: Partial<Record<CharacterId, string>> = { "adult-man": "owner_man", "adult-woman": "owner_woman" };
export const BODY_SCALE: Record<CharacterId, number> = { "adult-man": 1.264, "adult-woman": 1.302, boy: 1.322, girl: 1.264 };
export const HAT_FIT_SCALE: Record<CharacterId, number> = { "adult-man": 0.49, "adult-woman": 0.49, boy: 0.64, girl: 0.68 };
export const HAT_FILES: Record<HatId, string> = {
  "red-panda": "red-panda", "red-fox": "red-fox", chicken: "chicken", owl: "owl", elephant: "elephant", rhino: "rhino",
  giraffe: "giraffe", panda: "panda", frog: "frog", cow: "cow", rabbit: "rabbit", capybara: "capybara",
};
const ROLE_ANIMATION: Record<EmployeeRole, CrowdClipName> = { farmer: "Harvest", feeder: "PickupLow", operator: "LiftBox", stocker: "StockHigh", cashier: "ScanItem", builder: "CarryBox", manager: "Wave" };
export const LOCOMOTION_CLIPS = new Set<CrowdClipName>(["Walk", "Run", "CarryWalk", "CarryRun", "BasketWalk", "Enter", "Exit"]);
export const employeeBodyOf = (index: number) => EMPLOYEE_BODIES[index % EMPLOYEE_BODIES.length];

export interface CrowdBody {
  mesh: THREE.InstancedMesh;
  pose: THREE.InstancedBufferAttribute;
  animation: CrowdAnimationSet;
  count: number;
  dispose(): void;
}

export type BodyRegistry = InstanceRegistry<CrowdBody>;
export type PartsRegistry = InstanceRegistry<PartsInstancer>;

export function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

// Scratch objects shared by every frame update.
export const scratch = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  body: new THREE.Matrix4(),
  bone: new THREE.Matrix4(),
  bind: new THREE.Matrix4(),
  world: new THREE.Matrix4(),
  prop: new THREE.Matrix4(),
  slot: new THREE.Matrix4(),
  local: new THREE.Matrix4(),
  leftHand: new THREE.Vector3(),
  rightHand: new THREE.Vector3(),
  point: new THREE.Vector3(),
  yAxis: new THREE.Vector3(0, 1, 0),
  xAxis: new THREE.Vector3(1, 0, 0),
  roll: new THREE.Quaternion(),
  yaw: new THREE.Quaternion(),
  one: new THREE.Vector3(1, 1, 1),
  zero: new THREE.Vector3(0, 0, 0),
  euler: new THREE.Euler(),
  lean: new THREE.Quaternion(),
  bay: new THREE.Vector3(),
  source: new THREE.Vector3(),
  hand: new THREE.Vector3(),
  basket: new THREE.Vector3(),
};

/** QA ablation (`MARKET_PERF_EXPERIMENT=no-anim`): poses stop advancing. */
export function animationFrozen() {
  return MARKET_QA_BUILD_ENABLED && typeof window !== "undefined" && Boolean((window as Window & { __MARKET_PERF_NO_ANIM__?: boolean }).__MARKET_PERF_NO_ANIM__);
}

/** `window.__MARKET_QA__.customerVisuals` / `employeeVisuals` when a debug
 * QA page reads them (the old components published the same records). */
export function qaVisualsMap(key: "customerVisuals" | "employeeVisuals"): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
  if (!qaWindow.__MARKET_QA__ || !marketQaQueryEnabled(window.location.search)) return null;
  return (qaWindow.__MARKET_QA__[key] ??= {}) as Record<string, unknown>;
}

/** Joint world matrix in rig space (skin × bind), for sockets. */
export function socketMatrix(animation: CrowdAnimationSet, joint: "Head" | "Hand_L" | "Hand_R", row: number, target: THREE.Matrix4) {
  const index = crowdBoneIndex(animation, joint);
  const bind = animation.manifest.socketBind[joint];
  if (index < 0 || !bind) return target.identity();
  readCrowdBoneMatrix(animation, index, row, scratch.bone);
  scratch.bind.fromArray(bind);
  return target.multiplyMatrices(scratch.bone, scratch.bind);
}

/**
 * One body kind from its skinned source mesh and baked animation: an
 * InstancedMesh the frame loop fills. A `warm` position instead draws one
 * tiny instance there so the program compiles and the atlas and bone texture
 * upload while a loading cover is still up.
 */
export function createCrowdBody(source: THREE.SkinnedMesh, animation: CrowdAnimationSet, name: string, warm?: readonly [number, number, number]): CrowdBody {
  const baseMaterial = (Array.isArray(source.material) ? source.material[0] : source.material) as THREE.MeshStandardMaterial;
  // The GLB cache shares one geometry between every clone (the player's
  // avatar included); the per-instance pose attribute needs a copy of our own.
  const geometry = source.geometry.clone();
  const capacity = warm ? 1 : BODY_CAPACITY;
  const material = createCrowdMaterial(baseMaterial, animation);
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  const pose = createCrowdPoseAttribute(capacity);
  geometry.setAttribute(CROWD_INSTANCE_ATTRIBUTE, pose);
  mesh.name = `crowd-body:${name}${warm ? ":warm" : ""}`;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (warm) {
    mesh.setMatrixAt(0, scratch.local.compose(scratch.position.set(warm[0], warm[1], warm[2]), scratch.quaternion.identity(), scratch.scale.setScalar(0.002)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = 1;
  }
  return {
    mesh, pose, animation, count: 0,
    dispose() {
      mesh.removeFromParent();
      material.dispose();
      geometry.dispose();
      mesh.dispose();
    },
  };
}

/** The first skinned mesh of a loaded character scene. */
export function firstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((node) => { if (!found && node instanceof THREE.SkinnedMesh) found = node; });
  return found;
}

export function createPropInstancers(parent: THREE.Object3D, definitions: Record<string, { parts: InstancedPart[]; capacity: number }>, registry: PartsRegistry) {
  const created: PartsInstancer[] = [];
  for (const [key, definition] of Object.entries(definitions)) {
    const instancer = new PartsInstancer(definition.parts, definition.capacity, `crowd-prop:${key}`);
    instancer.attach(parent);
    registry.set(key, instancer);
    created.push(instancer);
  }
  return () => {
    for (const instancer of created) { instancer.detach(); instancer.dispose(); }
    registry.clear();
  };
}

const mergedCache = new Map<string, InstancedPart[]>();
function merged(key: string, parts: readonly InstancedPart[]) {
  let cached = mergedCache.get(key);
  if (!cached) { cached = mergeStaticParts(parts); mergedCache.set(key, cached); }
  return cached;
}

export function productPartDefinitions() {
  const definitions: Record<string, { parts: InstancedPart[]; capacity: number }> = {};
  for (const productId of PRODUCT_IDS) {
    const parts = basketProductParts(productId);
    if (parts) definitions[`product:${productId}`] = { parts: merged(`product:${productId}`, parts), capacity: PRODUCT_CAPACITY };
  }
  return definitions;
}

export const CUSTOMER_PROP_DEFINITIONS = () => ({
  shadow: { parts: GROUND_SHADOW_PARTS, capacity: PROP_CAPACITY },
  cart: { parts: merged("cart", CART_CHASSIS_PARTS), capacity: PROP_CAPACITY },
  caster: { parts: [CART_CASTER_PART], capacity: PROP_CAPACITY * 4 },
  wheel: { parts: [CART_WHEEL_PART], capacity: PROP_CAPACITY * 4 },
  cartBag: { parts: merged("cartBag", CART_BAG_PARTS), capacity: PROP_CAPACITY },
  handBag: { parts: merged("handBag", HAND_BAG_PARTS), capacity: PROP_CAPACITY },
  ...productPartDefinitions(),
});

export const EMPLOYEE_PROP_DEFINITIONS = () => ({
  shadow: { parts: GROUND_SHADOW_PARTS, capacity: PROP_CAPACITY },
  basket: { parts: merged("basket", HARVEST_BASKET_PARTS), capacity: PROP_CAPACITY },
  ...productPartDefinitions(),
});

export function pushProduct(products: PartsRegistry, delivered: PartsRegistry, productId: ProductId, matrix: THREE.Matrix4) {
  const own = products.get(`product:${productId}`);
  if (own) { own.push(matrix); return; }
  delivered.get(productId)?.push(matrix);
}

/** Delivered SKUs (milk, cheese, eggs) a set of baskets/carries needs. */
export function deliveredIdsIn(items: Iterable<Record<string, number | undefined>>) {
  const ids = new Set<"milk" | "cheese" | "egg">();
  for (const basket of items) for (const key of Object.keys(basket)) { const id = deliveredProductId(key); if (id) ids.add(id); }
  return [...ids];
}

function finishBodies(bodies: BodyRegistry) {
  for (const body of bodies.values()) {
    body.mesh.count = body.count;
    body.mesh.visible = body.count > 0;
    body.mesh.instanceMatrix.needsUpdate = true;
    body.pose.needsUpdate = true;
  }
}

// ─── Customers ──────────────────────────────────────────────────────────────

interface CustomerActor {
  snapshot: CustomerMotionSnapshot;
  snapshotTickMs: number;
  snapshotState: CustomerRuntimeState["state"];
  visualState: CustomerRuntimeState["state"];
  visualStateStartedAt: number;
  pose: CrowdPoseState;
  yaw: number;
  x: number;
  z: number;
  /** Cart origin in world space: it trails the palms, parks at the checkout
   * front or slides from the cart bay, as `CustomerCart` did. */
  cart: THREE.Vector3;
  /** Cart yaw relative to the body; parked carts turn back to the world axis. */
  cartLocalYaw: number;
  cartWasVisible: boolean;
  wheelRoll: number;
  steering: number;
  lean: number;
  pitch: number;
  pickupSpin: number;
  visualFrame: number;
  lastSeen: number;
}

const PICKUP_FACING_STATES = new Set<CustomerRuntimeState["state"]>(["WAIT_FOR_ACCESS", "PICK_PRODUCT", "WAIT_RESTOCK"]);
const CART_MAX_FOLLOW_LAG = 0.075;
const CUSTOMER_LOCOMOTION_CLIPS = new Set<CrowdClipName>(["Enter", "Exit", "Walk", "Run", "BasketWalk"]);

export class CrowdCustomersSystem {
  readonly bodies: BodyRegistry = new InstanceRegistry();
  readonly props: PartsRegistry = new InstanceRegistry();
  readonly delivered: PartsRegistry = new InstanceRegistry();
  /** Parent of every instanced mesh (its world matrix positions the crowd). */
  parent: THREE.Object3D | null = null;
  modelTier = 1;
  private readonly actors = new Map<string, CustomerActor>();

  attachTo(parent: THREE.Object3D | null) { this.parent = parent; }
  setModelTier(tier: number) { this.modelTier = tier; }

  /** One frame: `elapsed` in seconds since the clock started, `delta` the frame time. */
  update(camera: THREE.Camera, delta: number, elapsed: number) {
    const { bodies, props, delivered, parent, modelTier, actors } = this;
    updateCrowdFrustum(camera);
    const frameNow = nowMs();
    const dt = frameDelta(delta);
    const qaVisuals = qaVisualsMap("customerVisuals");
    const frozen = animationFrozen();
    for (const body of bodies.values()) body.count = 0;
    for (const instancer of props.values()) instancer.begin();
    for (const instancer of delivered.values()) instancer.begin();
    const shadows = props.get("shadow");
    const carts = props.get("cart");
    const casters = props.get("caster");
    const wheels = props.get("wheel");
    const cartBags = props.get("cartBag");
    const handBags = props.get("handBag");
    const cartBaseDrawCalls = (carts?.meshes.length ?? 0) + (casters?.meshes.length ?? 0) + (wheels?.meshes.length ?? 0);

    for (const customer of liveActors.customers.values()) {
      if (customer.state === "DESPAWN") continue;
      const body = bodies.get(CUSTOMER_BODY_KEYS[customer.identity]);
      if (!body || body.count >= BODY_CAPACITY) continue;
      let actor = actors.get(customer.id);
      if (!actor) {
        const [x, z] = scaleStorePoint([customer.x, customer.z]);
        actor = { snapshot: captureCustomerMotion(customer, frameNow), snapshotTickMs: liveActors.simulationTimeMs, snapshotState: customer.state, visualState: customer.state, visualStateStartedAt: frameNow, pose: createCrowdPose("Idle"), yaw: Math.PI, x, z, cart: new THREE.Vector3(x, 0, z), cartLocalYaw: 0, cartWasVisible: false, wheelRoll: 0, steering: 0, lean: 0, pitch: 0, pickupSpin: 0, visualFrame: 0, lastSeen: frameNow };
        actors.set(customer.id, actor);
      }
      actor.lastSeen = frameNow;
      actor.visualFrame += 1;
      if (liveActors.simulationTimeMs !== actor.snapshotTickMs || customer.state !== actor.snapshotState) {
        actor.snapshotTickMs = liveActors.simulationTimeMs;
        actor.snapshotState = customer.state;
        actor.snapshot = captureCustomerMotion(customer, frameNow);
      }
      const previousVisualState = actor.visualState;
      if (actor.visualState !== customer.state) { actor.visualState = customer.state; actor.visualStateStartedAt = frameNow; }
      const stateElapsedMs = frameNow - actor.visualStateStartedAt;
      const transaction = customer.transactionId ? liveActors.transactions.get(customer.transactionId) : undefined;
      const checkoutLoading = checkoutLoadingPresentation(customer.state, transaction, liveActors.simulationTimeMs);
      const projected = projectCustomerMotion(actor.snapshot, frameNow);
      const [x, z] = scaleStorePoint([projected.x, projected.z]);
      const scale = CUSTOMER_SCALE[customer.identity];
      const speed = Math.hypot(x - actor.x, z - actor.z) / Math.max(0.001, dt);
      actor.x = x; actor.z = z;
      const currentProduct = customer.shoppingList[customer.currentLine]?.productId ?? null;
      const productDisplay = currentProduct ? retailDisplayPosition(PRODUCT_RETAIL_DEPARTMENT[currentProduct]) : null;

      // Heading: the checkout lane, the path, or the display being picked from.
      const checkoutYaw = checkoutCustomerFacingYaw(customer, [projected.x, projected.z]);
      const previousYaw = actor.yaw;
      if (checkoutYaw !== null) actor.yaw = turnTowards(actor.yaw, checkoutYaw, dt * 3.8);
      else if (Math.hypot(projected.headingX, projected.headingZ) > 0.5) actor.yaw = turnTowards(actor.yaw, Math.atan2(projected.headingX, projected.headingZ), dt * 3.35);
      else if (productDisplay && PICKUP_FACING_STATES.has(customer.state)) {
        const [displayX, displayZ] = scaleStorePoint([productDisplay[0], productDisplay[2]]);
        actor.yaw = turnTowards(actor.yaw, Math.atan2(displayX - x, displayZ - z), dt * 3.8);
      }
      const headingStep = shortestHeadingDelta(previousYaw, actor.yaw);
      const cartVisible = customer.hasCart || customer.state === "GET_CART";
      const parkedCart = checkoutParkedCart(customer);

      if (!crowdCharacterInView(parent, x, z)) {
        if (qaVisuals) qaVisuals[customer.id] = { visualFrame: actor.visualFrame, inView: false, state: customer.state, animation: actor.pose.clip, x, z, rotationY: actor.yaw, speed: actor.snapshot.speed, snapshotCapturedAtMs: actor.snapshot.capturedAtMs, cartVisible, cartParked: Boolean(parkedCart), cartDistance: null, cartGripDistance: null, cartGripOffset: null, characterModelTier: modelTier };
        continue;
      }
      const runsFree = actor.snapshot.speed * STORE_LAYOUT_SCALE > 2.4 * CLIP_NATURAL_SPEED.Walk * scale;
      const clip = customerAnimation(customer, elapsed, Boolean(checkoutLoading), runsFree) as CrowdClipName;
      const timeScale = LOCOMOTION_CLIPS.has(clip) ? crowdGaitTimeScale(clip, speed, CLIP_NATURAL_SPEED[clip], scale) : 1;
      if (!frozen) actor.pose = advanceCrowdPose(actor.pose, clip, dt, timeScale, body.animation.manifest);
      const rows = crowdPoseRows(actor.pose, body.animation.manifest);

      // Body: root at the floor, facing its heading, leaning into turns and
      // forward while walking like the old character root, scaled like it.
      const locomotion = CUSTOMER_LOCOMOTION_CLIPS.has(clip);
      actor.lean = THREE.MathUtils.lerp(actor.lean, locomotion ? THREE.MathUtils.clamp(-headingStep / Math.max(0.001, dt) * 0.014, -0.045, 0.045) : 0, dampFactor(7, delta));
      actor.pitch = THREE.MathUtils.lerp(actor.pitch, locomotion ? -0.012 : 0, dampFactor(7, delta));
      scratch.yaw.setFromAxisAngle(scratch.yAxis, actor.yaw);
      scratch.world.compose(scratch.position.set(x, 0, z), scratch.yaw, scratch.one);
      scratch.lean.setFromEuler(scratch.euler.set(actor.pitch, 0, actor.lean));
      scratch.body.multiplyMatrices(scratch.world, scratch.local.compose(scratch.zero, scratch.lean, scratch.scale.setScalar(scale)));
      const slot = body.count;
      body.mesh.setMatrixAt(slot, scratch.body);
      body.pose.setXYZ(slot, rows.rowA, rows.rowB, rows.blend);
      body.count += 1;
      shadows?.push(scratch.body);

      // Hands in body space (rig space × lean × body scale) drive the cart and bag.
      socketMatrix(body.animation, "Hand_L", rows.rowA, scratch.prop);
      scratch.leftHand.setFromMatrixPosition(scratch.prop).multiplyScalar(scale).applyQuaternion(scratch.lean);
      socketMatrix(body.animation, "Hand_R", rows.rowA, scratch.prop);
      scratch.rightHand.setFromMatrixPosition(scratch.prop).multiplyScalar(scale).applyQuaternion(scratch.lean);

      let cartDistance: number | null = null;
      let cartGripDistance: number | null = null;
      let cartGripOffset: [number, number, number] | null = null;
      let cartProductUnits = 0;
      if (cartVisible && carts) {
        const singleLeft = checkoutLoading !== null || ["PICK_PRODUCT", "UNLOAD", "PAY", "LEAVE_RETURNS", "RETURN_CART"].includes(customer.state);
        const singleRight = ["GET_CART", "BUILD_SHOPPING_LIST", "TAKE_BAG"].includes(customer.state);
        const gripX = singleLeft ? scratch.leftHand.x + CART_HANDLE_BASE_WIDTH * CART_SCALE * 0.5 : singleRight ? scratch.rightHand.x - CART_HANDLE_BASE_WIDTH * CART_SCALE * 0.5 : (scratch.leftHand.x + scratch.rightHand.x) * 0.5;
        const gripZ = singleLeft ? scratch.leftHand.z : singleRight ? scratch.rightHand.z : (scratch.leftHand.z + scratch.rightHand.z) * 0.5;
        // Desired cart origin in world space: under the handle between the
        // palms, or parked at the lane front while the customer is served.
        scratch.point.set(gripX, 0, gripZ - CART_HANDLE_Z * CART_SCALE).applyMatrix4(scratch.world);
        if (parkedCart) scratch.point.set(parkedCart[0] * STORE_LAYOUT_SCALE, 0, parkedCart[1] * STORE_LAYOUT_SCALE);
        if (customer.state === "GET_CART" || customer.state === "RETURN_CART") {
          const progress = easedMotionProgress(stateElapsedMs, customer.state === "GET_CART" ? 450 : 420);
          scratch.bay.set(CART_BAY_POSITION[0], 0, CART_BAY_POSITION[1]);
          if (customer.state === "GET_CART") scratch.point.lerpVectors(scratch.bay, scratch.point, progress);
          else scratch.point.lerp(scratch.bay, progress);
        }
        const completedCartPickup = previousVisualState === "GET_CART" && customer.state !== "GET_CART";
        if (!actor.cartWasVisible || completedCartPickup) actor.cart.copy(scratch.point);
        else {
          actor.cart.lerp(scratch.point, dampFactor(30, delta));
          const remainingLag = actor.cart.distanceTo(scratch.point);
          if (remainingLag > CART_MAX_FOLLOW_LAG) actor.cart.lerp(scratch.point, 1 - CART_MAX_FOLLOW_LAG / remainingLag);
        }
        actor.cartWasVisible = true;
        actor.cartLocalYaw = THREE.MathUtils.lerp(actor.cartLocalYaw, parkedCart ? -actor.yaw : 0, dampFactor(14, delta));
        // Wheels roll with the ground distance the cart covered this frame and
        // the casters swivel into turns.
        actor.wheelRoll += wheelRollDelta(speed * dt / CART_SCALE, CUSTOMER_CART_WHEEL_RADIUS);
        actor.steering = THREE.MathUtils.lerp(actor.steering, cartSteeringAngle(headingStep, dt), dampFactor(10, delta));
        scratch.quaternion.setFromAxisAngle(scratch.yAxis, actor.yaw + actor.cartLocalYaw);
        scratch.prop.compose(actor.cart, scratch.quaternion, scratch.scale.setScalar(CART_SCALE));
        carts.push(scratch.prop);
        if (casters && wheels) {
          for (let index = 0; index < CART_CASTER_POSITIONS.length; index += 1) {
            const [cx, cy, cz] = CART_CASTER_POSITIONS[index];
            const yaw = index < 2 ? actor.steering : actor.steering * 0.32;
            scratch.quaternion.setFromAxisAngle(scratch.yAxis, yaw);
            scratch.slot.compose(scratch.position.set(cx, cy, cz), scratch.quaternion, scratch.one);
            casters.pushPart(0, scratch.prop, scratch.slot);
            casters.count += 1;
            scratch.roll.setFromAxisAngle(scratch.xAxis, actor.wheelRoll);
            scratch.quaternion.multiply(scratch.roll);
            scratch.slot.compose(scratch.position.set(cx, cy, cz), scratch.quaternion, scratch.one);
            wheels.pushPart(0, scratch.prop, scratch.slot);
            wheels.count += 1;
          }
        }
        const units = checkoutCartInventory(customer.basket, transaction);
        let unit = 0;
        for (const productId of PRODUCT_IDS) {
          const quantity = units[productId] ?? 0;
          cartProductUnits += quantity;
          for (let n = 0; n < Math.min(quantity, 2) && unit < 5; n += 1, unit += 1) {
            scratch.slot.multiplyMatrices(CART_BASKET_SOCKET, cartProductSlot(unit, scratch.local));
            pushProduct(props, delivered, productId, scratch.bone.multiplyMatrices(scratch.prop, scratch.slot));
          }
        }
        if (customer.hasBag) cartBags?.push(scratch.prop);
        if (qaVisuals) {
          cartDistance = actor.cart.distanceTo(scratch.position.set(x, 0, z));
          scratch.hand.addVectors(scratch.leftHand, scratch.rightHand).multiplyScalar(0.5).applyMatrix4(scratch.world);
          scratch.point.set(0, CART_HANDLE_Y, CART_HANDLE_Z).applyMatrix4(scratch.prop);
          cartGripDistance = scratch.hand.distanceTo(scratch.point);
          cartGripOffset = [scratch.hand.x - scratch.point.x, scratch.hand.y - scratch.point.y, scratch.hand.z - scratch.point.z];
        }
      } else {
        actor.cartWasVisible = false;
      }

      // The unit being picked flies from the display to the hand and into the
      // cart basket over the pickup duration (`productTransferPoint`).
      let pickupProgress: number | null = null;
      const pickupActive = customer.state === "PICK_PRODUCT" && currentProduct !== null && productDisplay !== null && cartVisible && actor.cartWasVisible;
      if (pickupActive && currentProduct && productDisplay) {
        pickupProgress = motionProgress(stateElapsedMs, CUSTOMER_PICKUP_DURATION_MS);
        const [displayX, displayZ] = scaleStorePoint([productDisplay[0], productDisplay[2]]);
        const towardX = x - displayX;
        const towardZ = z - displayZ;
        const sourceDistance = Math.max(0.001, Math.hypot(towardX, towardZ));
        const edge = 0.92 * STORE_ELEMENT_SCALE;
        const lateral = productPickupLateralOffset(currentProduct) * STORE_ELEMENT_SCALE;
        scratch.source.set(
          displayX + towardX / sourceDistance * edge - towardZ / sourceDistance * lateral,
          PICKUP_HEIGHT[currentProduct] * STORE_ELEMENT_SCALE,
          displayZ + towardZ / sourceDistance * edge + towardX / sourceDistance * lateral,
        );
        scratch.hand.copy(scratch.rightHand).applyMatrix4(scratch.world);
        scratch.basket.setFromMatrixPosition(CART_BASKET_SOCKET).applyMatrix4(scratch.prop);
        const point = productTransferPoint(scratch.source.toArray(), scratch.hand.toArray(), scratch.basket.toArray(), pickupProgress);
        actor.pickupSpin += dt * 4.8;
        scratch.quaternion.setFromAxisAngle(scratch.yAxis, actor.pickupSpin);
        pushProduct(props, delivered, currentProduct, scratch.slot.compose(scratch.position.set(point[0], point[1], point[2]), scratch.quaternion, scratch.scale.setScalar(1.35)));
      }

      const receivingBag = customer.state === "TAKE_BAG";
      const bagVisible = receivingBag || (customer.hasBag && !customer.hasCart);
      if (handBags && bagVisible) {
        const bagScale = receivingBag ? 0.72 + easedMotionProgress(stateElapsedMs, 520) * 0.28 : 1;
        scratch.slot.multiplyMatrices(scratch.world, scratch.local.compose(scratch.leftHand, scratch.lean, scratch.scale.setScalar(bagScale * scale)));
        handBags.push(scratch.slot);
      }

      if (qaVisuals) {
        qaVisuals[customer.id] = {
          visualFrame: actor.visualFrame,
          inView: true,
          state: customer.state,
          animation: clip,
          x, z,
          rotationY: actor.yaw,
          checkoutFacingYaw: checkoutYaw,
          checkoutFacingError: checkoutYaw === null ? null : Math.abs(shortestHeadingDelta(actor.yaw, checkoutYaw)),
          speed: actor.snapshot.speed,
          gaitScale: timeScale,
          snapshotCapturedAtMs: actor.snapshot.capturedAtMs,
          cartVisible,
          cartParked: Boolean(parkedCart),
          cartPosition: actor.cart.toArray(),
          cartDistance,
          cartGripDistance,
          cartGripOffset,
          cartSteering: actor.steering,
          cartWheelRotation: actor.wheelRoll,
          cartProductUnits,
          checkoutLoadedUnits: transaction?.pendingItems.reduce((total, line) => total + line.loaded, 0) ?? 0,
          checkoutLoadingUnit: checkoutLoading?.unitIndex ?? null,
          checkoutLoadingProgress: checkoutLoading?.cycleProgress ?? null,
          characterModelTier: modelTier,
          cartBaseDrawCalls,
          pickupVisible: pickupActive,
          pickupProduct: customer.state === "PICK_PRODUCT" ? currentProduct : null,
          pickupProgress,
          bagVisible,
        };
      }
    }

    // Forget actors that left; keep the map bounded.
    for (const [id, actor] of actors) {
      if (frameNow - actor.lastSeen <= 2_000) continue;
      actors.delete(id);
      if (qaVisuals) delete qaVisuals[id];
    }

    finishBodies(bodies);
    for (const instancer of props.values()) instancer.end();
    for (const instancer of delivered.values()) instancer.end();
  }
}

// ─── Employees ──────────────────────────────────────────────────────────────

interface EmployeeActor {
  snapshot: CustomerMotionSnapshot | null;
  snapshotSource: EmployeeRuntimeState | undefined;
  pose: CrowdPoseState;
  locomotion: LocomotionController;
  yaw: number;
  x: number;
  z: number;
  visualFrame: number;
  lastSeen: number;
}

export class CrowdEmployeesSystem {
  readonly bodies: BodyRegistry = new InstanceRegistry();
  readonly hats: PartsRegistry = new InstanceRegistry();
  readonly props: PartsRegistry = new InstanceRegistry();
  readonly delivered: PartsRegistry = new InstanceRegistry();
  parent: THREE.Object3D | null = null;
  employees: readonly Employee[] = [];
  private readonly actors = new Map<string, EmployeeActor>();

  attachTo(parent: THREE.Object3D | null) { this.parent = parent; }
  setEmployees(employees: readonly Employee[]) { this.employees = employees; }

  update(camera: THREE.Camera, delta: number) {
    const { bodies, hats, props, delivered, parent, employees, actors } = this;
    updateCrowdFrustum(camera);
    const frameNow = nowMs();
    const dt = frameDelta(delta);
    const qaVisuals = qaVisualsMap("employeeVisuals");
    const frozen = animationFrozen();
    for (const body of bodies.values()) body.count = 0;
    for (const instancer of props.values()) instancer.begin();
    for (const instancer of hats.values()) instancer.begin();
    for (const instancer of delivered.values()) instancer.begin();
    const shadows = props.get("shadow");
    const baskets = props.get("basket");

    employees.forEach((employee, index) => {
      const runtime = liveActors.employees.get(employee.id) ?? employee.runtime;
      if (!runtime) return;
      const bodyId = employeeBodyOf(index);
      const body = bodies.get(EMPLOYEE_BODY_KEYS[bodyId] ?? "");
      if (!body || body.count >= BODY_CAPACITY) return;
      let actor = actors.get(employee.id);
      if (!actor) {
        const [x, z] = scaleStorePoint([runtime.x, runtime.z]);
        actor = { snapshot: null, snapshotSource: undefined, pose: createCrowdPose("Idle"), locomotion: new LocomotionController(), yaw: Math.PI, x, z, visualFrame: 0, lastSeen: frameNow };
        actors.set(employee.id, actor);
      }
      actor.lastSeen = frameNow;
      if (runtime !== actor.snapshotSource || !actor.snapshot) {
        actor.snapshotSource = runtime;
        actor.snapshot = captureEmployeeMotion(runtime, frameNow);
      }
      const projected = projectCustomerMotion(actor.snapshot, frameNow);
      const [x, z] = scaleStorePoint([projected.x, projected.z]);
      const speed = Math.hypot(x - actor.x, z - actor.z) / Math.max(0.001, dt);
      actor.x = x; actor.z = z;
      actor.visualFrame += 1;
      if (qaVisuals) qaVisuals[employee.id] = { visualFrame: actor.visualFrame, role: employee.role, level: employee.level, state: runtime.state, x, z, speed: actor.snapshot.speed, snapshotCapturedAtMs: actor.snapshot.capturedAtMs, configuredSpeed: runtime.speed, carrying: carryTotal(runtime.carry) > 0, animation: actor.pose.clip };
      if (!crowdCharacterInView(parent, x, z)) return;
      const moving = runtime.state === "NAVIGATE_PICKUP" || runtime.state === "NAVIGATE_DROPOFF" || runtime.state === "NAVIGATE_RETURN" || runtime.state === "NAVIGATE_CHECKOUT";
      const previousYaw = actor.yaw;
      if (moving && Math.hypot(projected.headingX, projected.headingZ) > 0.5) actor.yaw = turnTowards(actor.yaw, Math.atan2(projected.headingX, projected.headingZ), dt * 3);
      else if (employee.role === "cashier" && (runtime.state === "OPERATE_CHECKOUT" || runtime.state === "WAIT_CHECKOUT_STATION")) actor.yaw = turnTowards(actor.yaw, Math.PI, dt * 3.5);
      const yawDelta = actor.yaw - previousYaw;

      const carrying = carryTotal(runtime.carry) > 0;
      const interaction = runtime.state === "PICKUP" || runtime.state === "DROPOFF" || runtime.state === "RETURN_TO_WAREHOUSE" || runtime.state === "OPERATE_CHECKOUT";
      const rootScale = ADULT_CHARACTER_SCENE_SCALE * BODY_SCALE[bodyId];
      const walkFloor = CLIP_NATURAL_SPEED[carrying ? "CarryWalk" : "Walk"] * rootScale;
      const clip: CrowdClipName = interaction
        ? (runtime.state === "RETURN_TO_WAREHOUSE" ? "StockLow" : ROLE_ANIMATION[employee.role])
        : actor.locomotion.select(speed, yawDelta, carrying, walkFloor) as CrowdClipName;
      const timeScale = LOCOMOTION_CLIPS.has(clip) ? crowdGaitTimeScale(clip, speed, CLIP_NATURAL_SPEED[clip], rootScale) : 1;
      if (!frozen) actor.pose = advanceCrowdPose(actor.pose, clip, dt, timeScale, body.animation.manifest);
      const rows = crowdPoseRows(actor.pose, body.animation.manifest);

      scratch.yaw.setFromAxisAngle(scratch.yAxis, actor.yaw);
      scratch.world.compose(scratch.position.set(x, 0, z), scratch.yaw, scratch.one);
      scratch.body.multiplyMatrices(scratch.world, scratch.local.makeScale(rootScale, rootScale, rootScale));
      const slot = body.count;
      body.mesh.setMatrixAt(slot, scratch.body);
      body.pose.setXYZ(slot, rows.rowA, rows.rowB, rows.blend);
      body.count += 1;
      shadows?.push(scratch.body);

      // Hat on the head bone, fitted like the avatar's appearance root.
      const hat = hats.get(`${bodyId}:${employee.hat}`);
      if (hat) {
        socketMatrix(body.animation, "Head", rows.rowA, scratch.prop);
        scratch.slot.multiplyMatrices(scratch.body, scratch.prop);
        hat.push(scratch.slot.multiply(scratch.local.makeScale(HAT_FIT_SCALE[bodyId], HAT_FIT_SCALE[bodyId], HAT_FIT_SCALE[bodyId])));
      }

      if (carrying && baskets) {
        // The handle bar sits between the palms; the basket hangs from it.
        const palms = CHARACTER_PALM_OFFSETS[bodyId];
        socketMatrix(body.animation, "Hand_L", rows.rowA, scratch.prop);
        scratch.leftHand.fromArray(palms.left as unknown as number[]).applyMatrix4(scratch.prop);
        socketMatrix(body.animation, "Hand_R", rows.rowA, scratch.prop);
        scratch.rightHand.fromArray(palms.right as unknown as number[]).applyMatrix4(scratch.prop);
        // The carry socket sits under and behind the palm midpoint, centred on
        // the body, exactly as `placeCarrySocket` puts it for the avatar.
        scratch.point.addVectors(scratch.leftHand, scratch.rightHand).multiplyScalar(0.5);
        scratch.point.set(0, scratch.point.y - HARVEST_BASKET_GRIP_HEIGHT, scratch.point.z + HARVEST_BASKET_GRIP_REACH);
        scratch.slot.multiplyMatrices(scratch.body, scratch.local.compose(scratch.point, scratch.quaternion.identity(), scratch.one));
        baskets.push(scratch.slot);
        const visible = carriedProductIds(runtime.carry).flatMap((productId) => Array.from({ length: carryQuantity(runtime.carry, productId) }, () => productId)).slice(0, MAX_WAREHOUSE_PICKUP_BATCH);
        visible.forEach((productId, unit) => {
          pushProduct(props, delivered, productId, scratch.bone.multiplyMatrices(scratch.slot, harvestProductSlot(unit, scratch.local)));
        });
      }
    });

    for (const [id, actor] of actors) {
      if (frameNow - actor.lastSeen <= 2_000) continue;
      actors.delete(id);
      if (qaVisuals) delete qaVisuals[id];
    }
    finishBodies(bodies);
    for (const instancer of props.values()) instancer.end();
    for (const instancer of hats.values()) instancer.end();
    for (const instancer of delivered.values()) instancer.end();
  }
}
