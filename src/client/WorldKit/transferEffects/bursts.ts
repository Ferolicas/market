import * as THREE from "three";
import type { ProductId } from "@/game/types";
import type { OpeningPurchaseId } from "@/game/progression/MartCampaign";
import { farmPlotById } from "@/game/stations/farm-layout";
import { scaleStorePosition, STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE } from "@/game/world-scale";
import { PRODUCT_RETAIL_DEPARTMENT, RETAIL_DEPARTMENTS, retailFixtureDisplayPositions, retailStockFixtureSlot, retailStockLandingLocalPosition, type RetailDepartmentId } from "@/game/stations/retail-layout";
import { WAREHOUSE_RETURN_STATION } from "@/game/stations/warehouse-layout";
import { PURCHASE_POSITIONS } from "@/game/stations/purchase-layout";
import { attachProductParticle, buildCashBundleMesh, buildHarvestSparkle, buildStockSparkle } from "./productParticle";

/**
 * Imperative ports of `HarvestMagnetBurst` / `StockMagnetBurst` /
 * `ReturnMagnetBurst` / `PayMagnetBurst` (`MarketScene.tsx`, ~lines
 * 657-907). Every stagger, duration, easing curve and per-particle transform
 * formula below is copied verbatim from that source — read once, not
 * estimated — including the two deltas the source keeps separate: `elapsed`
 * (position/landing timing) advances on `visualTransferDelta(delta)` — the
 * same 0.25s-capped, NaN-safe clamp the source applies — while spin
 * (`rotation.x`/`rotation.y`/`rotation.z` increments) advances on the RAW,
 * uncapped frame delta, exactly like the source's `useFrame(_, delta)` does.
 *
 * `onProgress` fires once per frame for a burst whose landed-unit count just
 * changed, exactly mirroring the source's own `useFrame`-driven call —
 * `GameShell.updateTransferProgress` already coalesces these to one state
 * update per animation frame on its side, so calling it eagerly here is
 * exactly as cheap as the real client.
 */

export type TransferProgressCallback = (sequence: number, remainingQuantity: number) => void;

export interface ActiveBurst {
  readonly group: THREE.Group;
  /** Advances this burst by one rendered frame. `rawDeltaSeconds` is the
   * unclamped frame delta (used for spin, exactly like the source's `delta`);
   * `basketWorld` is the player's live basket anchor in the same layout-scale
   * coordinate space `scaleStorePosition()` output lives in. */
  tick(rawDeltaSeconds: number, basketWorld: THREE.Vector3, onProgress: TransferProgressCallback): void;
  /** Detaches this burst's group from its parent. Geometries/materials are
   * shared module-level singletons (see `productParticle.ts`) and outlive
   * any one burst, so there is nothing else to release. */
  dispose(): void;
}

/** `visualTransferDelta()` from MarketScene.tsx: transfer flights follow a
 * bounded real frame delta so a suspended/backgrounded tab never completes
 * an entire burst in one jump on resume. */
const MAX_VISUAL_TRANSFER_DELTA = 0.25;
function visualTransferDelta(delta: number): number {
  return Math.min(MAX_VISUAL_TRANSFER_DELTA, Math.max(0, Number.isFinite(delta) ? delta : 0));
}

function clampParticleCount(quantity: number, cap: number): number {
  return Math.min(cap, Math.max(1, Math.floor(quantity)));
}

/** Bookkeeping shared by all four bursts: a sticky "landed" flag per particle
 * (once true, stays true — landing is monotonic, never re-evaluated) and the
 * "only call onProgress when the remaining count actually changed" gate. */
function createLandingTracker(particleCount: number, sequence: number) {
  const landed: boolean[] = new Array(particleCount).fill(false);
  let published = particleCount;
  return {
    landed,
    settle(onProgress: TransferProgressCallback) {
      let landedCount = 0;
      for (let index = 0; index < particleCount; index += 1) if (landed[index]) landedCount += 1;
      const remaining = particleCount - landedCount;
      if (remaining === published) return;
      published = remaining;
      onProgress(sequence, remaining);
    },
  };
}

function disposeBurst(group: THREE.Group) {
  group.parent?.remove(group);
}

/** Mirrors the source's inline `__MARKET_QA__` publishing on `HarvestMagnetBurst`/
 * `StockMagnetBurst` (the only two bursts that publish it) — the existing
 * Playwright-based verification tooling for this session reads these same
 * keys, so omitting them would silently blind that tooling to burst behavior
 * in `/runtime`, not just skip an unused debug affordance. */
function qaWindow(): Record<string, unknown> | null {
  const qa = (window as typeof window & { __MARKET_QA__?: Record<string, unknown> }).__MARKET_QA__;
  return qa ?? null;
}
function qaPush(key: string, entry: unknown, cap: number) {
  const qa = qaWindow();
  if (!qa) return;
  const previous = Array.isArray(qa[key]) ? (qa[key] as unknown[]) : [];
  qa[key] = [...previous, entry].slice(-cap);
}

// ─── Harvest: crop plot → player basket ────────────────────────────────────

export function createHarvestBurst(sequence: number, cropId: string, productId: ProductId, quantity: number): ActiveBurst {
  const particleCount = clampParticleCount(quantity, 20);
  const plot = farmPlotById(cropId);
  const source = scaleStorePosition(plot ? [...plot.position] as [number, number, number] : [0, 0, 0]);
  const offsets: readonly [number, number, number][] = Array.from({ length: particleCount }, (_, index) => [
    ((index % 3) - 1) * 0.28,
    0.06 + Math.floor(index / 3) * 0.025,
    (Math.floor(index / 3) - (Math.ceil(particleCount / 3) - 1) / 2) * 0.22,
  ]);

  const group = new THREE.Group();
  group.name = `transfer:harvest:${sequence}`;
  let disposed = false;
  const particles: THREE.Group[] = [];
  if (plot) {
    for (let index = 0; index < particleCount; index += 1) {
      const particle = new THREE.Group();
      particle.visible = false;
      attachProductParticle(particle, productId, 1.22, () => disposed);
      particle.add(buildHarvestSparkle());
      group.add(particle);
      particles.push(particle);
    }
  }

  const tracker = createLandingTracker(particleCount, sequence);
  let elapsed = 0;
  let completionPublished = false;

  if (plot) {
    const entry = { sequence, cropId, productId, visualUnits: particleCount };
    qaPush("harvestBursts", entry, 24);
    const qa = qaWindow();
    if (qa) qa.harvestBurst = entry;
  }

  return {
    group,
    tick(rawDeltaSeconds, basketWorld, onProgress) {
      elapsed += visualTransferDelta(rawDeltaSeconds);
      for (let index = 0; index < particleCount; index += 1) {
        const t = THREE.MathUtils.clamp((elapsed - index * 0.045) / 0.52, 0, 1);
        if (t >= 1) tracker.landed[index] = true;
        const particle = particles[index];
        if (!particle) continue;
        const visible = t < 1 && elapsed >= index * 0.045;
        particle.visible = visible;
        if (!visible) continue;
        const eased = 1 - Math.pow(1 - t, 3);
        const offset = offsets[index];
        particle.position.set(
          THREE.MathUtils.lerp(source[0] + offset[0] * STORE_ELEMENT_SCALE, basketWorld.x, eased),
          THREE.MathUtils.lerp(0.72 * STORE_ELEMENT_SCALE + offset[1], basketWorld.y, eased) + Math.sin(Math.PI * t) * 1.35,
          THREE.MathUtils.lerp(source[2] + offset[2] * STORE_ELEMENT_SCALE, basketWorld.z, eased),
        );
        particle.rotation.y += rawDeltaSeconds * (5.5 + index);
        particle.rotation.z = Math.sin(t * Math.PI * 3 + index) * 0.28;
        particle.scale.setScalar((0.86 + Math.sin(Math.PI * t) * 0.24) * (1 - t * 0.18));
      }
      tracker.settle((seq, remaining) => {
        qaPush("harvestBurstProgress", { sequence: seq, cropId, productId, remainingQuantity: remaining }, 48);
        if (remaining === 0 && !completionPublished) {
          completionPublished = true;
          qaPush("harvestBurstCompletions", { sequence: seq, cropId, productId, quantity: particleCount }, 24);
        }
        onProgress(seq, remaining);
      });
    },
    dispose() {
      disposed = true;
      disposeBurst(group);
    },
  };
}

// ─── Stock: player basket → shelf/department fixture ───────────────────────

export function createStockBurst(sequence: number, productId: ProductId, quantity: number, shelfStart: number, unlockedAreas: readonly string[]): ActiveBurst {
  const particleCount = clampParticleCount(quantity, 20);
  const departmentId: RetailDepartmentId = PRODUCT_RETAIL_DEPARTMENT[productId];
  const displayYaw = THREE.MathUtils.degToRad(RETAIL_DEPARTMENTS[departmentId].yaw ?? 0);
  const particleTargets: readonly [number, number, number][] = Array.from({ length: particleCount }, (_, index): [number, number, number] => {
    const slot = retailStockFixtureSlot(departmentId, shelfStart + index, shelfStart + particleCount, unlockedAreas);
    const displayPosition = retailFixtureDisplayPositions(departmentId, unlockedAreas)[slot.fixtureIndex];
    const landing = retailStockLandingLocalPosition(productId, slot.localOrdinal, slot.localEnd);
    const localX = landing[0] * Math.cos(displayYaw) + landing[2] * Math.sin(displayYaw);
    const localZ = -landing[0] * Math.sin(displayYaw) + landing[2] * Math.cos(displayYaw);
    return [
      displayPosition[0] * STORE_LAYOUT_SCALE + localX * STORE_ELEMENT_SCALE,
      landing[1] * STORE_ELEMENT_SCALE,
      displayPosition[2] * STORE_LAYOUT_SCALE + localZ * STORE_ELEMENT_SCALE,
    ];
  });

  const group = new THREE.Group();
  group.name = `transfer:stock:${sequence}`;
  let disposed = false;
  const particles: THREE.Group[] = [];
  for (let index = 0; index < particleCount; index += 1) {
    const particle = new THREE.Group();
    particle.visible = false;
    attachProductParticle(particle, productId, 1.16, () => disposed);
    particle.add(buildStockSparkle());
    group.add(particle);
    particles.push(particle);
  }

  const sources: (THREE.Vector3 | null)[] = new Array(particleCount).fill(null);
  const tracker = createLandingTracker(particleCount, sequence);
  let elapsed = 0;
  let completionPublished = false;

  {
    const [targetX, targetY, targetZ] = particleTargets[0];
    qaPush("stockBursts", { sequence, productId, departmentId, quantity: particleCount, target: { x: targetX, y: targetY, z: targetZ } }, 24);
  }

  return {
    group,
    tick(rawDeltaSeconds, basketWorld, onProgress) {
      elapsed += visualTransferDelta(rawDeltaSeconds);
      for (let index = 0; index < particleCount; index += 1) {
        const started = elapsed >= index * 0.065;
        if (started && !sources[index]) sources[index] = basketWorld.clone();
        const t = THREE.MathUtils.clamp((elapsed - index * 0.065) / 0.5, 0, 1);
        if (t >= 1) tracker.landed[index] = true;
        const particle = particles[index];
        if (!particle) continue;
        particle.visible = t < 1 && started;
        if (!particle.visible) continue;
        const eased = t * t * (3 - 2 * t);
        const particleTarget = particleTargets[index];
        const source = sources[index] ?? basketWorld;
        particle.position.set(
          THREE.MathUtils.lerp(source.x, particleTarget[0], eased),
          THREE.MathUtils.lerp(source.y, particleTarget[1], eased) + Math.sin(Math.PI * t) * 0.82,
          THREE.MathUtils.lerp(source.z, particleTarget[2], eased),
        );
        particle.rotation.x += rawDeltaSeconds * (3.5 + index * 0.3);
        particle.rotation.y += rawDeltaSeconds * (5.2 + index * 0.45);
        particle.scale.setScalar(0.94 + Math.sin(Math.PI * t) * 0.18);
      }
      tracker.settle((seq, remaining) => {
        qaPush("stockBurstProgress", { sequence: seq, productId, departmentId, remainingQuantity: remaining }, 48);
        if (remaining === 0 && !completionPublished) {
          completionPublished = true;
          qaPush("stockBurstCompletions", { sequence: seq, productId, departmentId, quantity: particleCount }, 24);
        }
        onProgress(seq, remaining);
      });
    },
    dispose() {
      disposed = true;
      disposeBurst(group);
    },
  };
}

// ─── Return: player basket → warehouse return crate ────────────────────────

const WAREHOUSE_RETURN_LANDING: readonly [number, number, number] = [
  WAREHOUSE_RETURN_STATION.position[0] * STORE_LAYOUT_SCALE,
  0.3 * STORE_ELEMENT_SCALE,
  WAREHOUSE_RETURN_STATION.position[2] * STORE_LAYOUT_SCALE,
];

export function createReturnBurst(sequence: number, productId: ProductId, quantity: number): ActiveBurst {
  const particleCount = clampParticleCount(quantity, 20);

  const group = new THREE.Group();
  group.name = `transfer:return:${sequence}`;
  let disposed = false;
  const particles: THREE.Group[] = [];
  for (let index = 0; index < particleCount; index += 1) {
    const particle = new THREE.Group();
    particle.visible = false;
    attachProductParticle(particle, productId, 1.16, () => disposed);
    particle.add(buildStockSparkle());
    group.add(particle);
    particles.push(particle);
  }

  const sources: (THREE.Vector3 | null)[] = new Array(particleCount).fill(null);
  const tracker = createLandingTracker(particleCount, sequence);
  let elapsed = 0;

  return {
    group,
    tick(rawDeltaSeconds, basketWorld, onProgress) {
      elapsed += visualTransferDelta(rawDeltaSeconds);
      for (let index = 0; index < particleCount; index += 1) {
        const started = elapsed >= index * 0.065;
        if (started && !sources[index]) sources[index] = basketWorld.clone();
        const t = THREE.MathUtils.clamp((elapsed - index * 0.065) / 0.5, 0, 1);
        if (t >= 1) tracker.landed[index] = true;
        const particle = particles[index];
        if (!particle) continue;
        particle.visible = t < 1 && started;
        if (!particle.visible) continue;
        const eased = t * t * (3 - 2 * t);
        const source = sources[index] ?? basketWorld;
        const slot = ((index % 4) - 1.5) * 0.09 * STORE_ELEMENT_SCALE;
        particle.position.set(
          THREE.MathUtils.lerp(source.x, WAREHOUSE_RETURN_LANDING[0] + slot, eased),
          THREE.MathUtils.lerp(source.y, WAREHOUSE_RETURN_LANDING[1], eased) + Math.sin(Math.PI * t) * 0.82,
          THREE.MathUtils.lerp(source.z, WAREHOUSE_RETURN_LANDING[2], eased),
        );
        particle.rotation.x += rawDeltaSeconds * (3.5 + index * 0.3);
        particle.rotation.y += rawDeltaSeconds * (5.2 + index * 0.45);
        particle.scale.setScalar(0.94 + Math.sin(Math.PI * t) * 0.18);
      }
      tracker.settle(onProgress);
    },
    dispose() {
      disposed = true;
      disposeBurst(group);
    },
  };
}

// ─── Pay: player hands → purchase marker square ────────────────────────────

export function createPayBurst(sequence: number, purchaseId: OpeningPurchaseId, quantity: number): ActiveBurst {
  const particleCount = clampParticleCount(quantity, 8);
  const targetPosition = scaleStorePosition(PURCHASE_POSITIONS[purchaseId]);
  const target = new THREE.Vector3(targetPosition[0], targetPosition[1] + 0.06, targetPosition[2]);

  const group = new THREE.Group();
  group.name = `transfer:pay:${sequence}`;
  const particles: THREE.Group[] = [];
  for (let index = 0; index < particleCount; index += 1) {
    const particle = new THREE.Group();
    particle.visible = false;
    particle.add(buildCashBundleMesh());
    group.add(particle);
    particles.push(particle);
  }

  const sources: (THREE.Vector3 | null)[] = new Array(particleCount).fill(null);
  const tracker = createLandingTracker(particleCount, sequence);
  let elapsed = 0;

  return {
    group,
    tick(rawDeltaSeconds, basketWorld, onProgress) {
      elapsed += visualTransferDelta(rawDeltaSeconds);
      for (let index = 0; index < particleCount; index += 1) {
        const started = elapsed >= index * 0.04;
        if (started && !sources[index]) sources[index] = basketWorld.clone();
        const t = THREE.MathUtils.clamp((elapsed - index * 0.04) / 0.32, 0, 1);
        if (t >= 1) tracker.landed[index] = true;
        const particle = particles[index];
        if (!particle) continue;
        particle.visible = t < 1 && started;
        if (!particle.visible) continue;
        const eased = t * t * (3 - 2 * t);
        const source = sources[index] ?? basketWorld;
        const spreadX = ((index % 3) - 1) * 0.12 * STORE_ELEMENT_SCALE;
        const spreadZ = ((index % 2) - 0.5) * 0.1 * STORE_ELEMENT_SCALE;
        particle.position.set(
          THREE.MathUtils.lerp(source.x, target.x + spreadX, eased),
          THREE.MathUtils.lerp(source.y, target.y, eased) + Math.sin(Math.PI * t) * 0.7,
          THREE.MathUtils.lerp(source.z, target.z + spreadZ, eased),
        );
        particle.rotation.x += rawDeltaSeconds * (6 + index);
        particle.rotation.z += rawDeltaSeconds * 4;
      }
      tracker.settle(onProgress);
    },
    dispose() {
      disposeBurst(group);
    },
  };
}
