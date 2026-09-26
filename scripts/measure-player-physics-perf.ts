/**
 * One-off measurement: does the Rapier-based player character controller
 * (`src/client/PlayerPhysics.ts`, added 2026-09-26 to replace the player's
 * navmesh-based movement — see that file's doc comment) cost an acceptable
 * amount of frame time? The old navmesh call it replaced
 * (`storeMoveAlongSurface`) was measured at ~0.1ms average / 0.1ms p99 / 2.6ms
 * max per call in `RUNTIME_PHASE10_BASELINE` (`src/runtime/contract.ts`).
 * This script reports the equivalent numbers for `resolveMovement()`, plus
 * the rarer `updateDoors()`/`setUnlockedAreas()` calls.
 *
 * Run with: npx tsx scripts/measure-player-physics-perf.ts
 */
import { performance } from "node:perf_hooks";
import { buildPlayerPhysics, ensureRapierReady } from "../src/client/PlayerPhysics";

// Copied from `LEVEL30_UNLOCKED_AREAS` in `src/runtime/scene.ts` (legacy
// runtime-harness code, not imported from directly) — the full campaign's
// worth of unlocked areas, i.e. the realistic worst case for collider count.
const LEVEL30_UNLOCKED_AREAS = [
  "store-floor", "farm-tomato", "checkout-1", "purchase-campaign", "egg-display", "chicken-coop",
  "farm-tomato-2", "expansion-side", "farm-tomato-3", "checkout-2", "farm-wheat", "chicken-coop-2",
  "flour-mill", "bread-oven", "dairy-display", "cow-station", "checkout-3", "cheese-maker",
  "farm-apple", "farm-corn", "coffee-supply", "farm-coffee", "farm-orange", "juice-machine",
  "preserves-supply", "corn-canner",
];

const PHYSICS_STEP = 1 / 60;

function stats(samplesMs: number[]) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const avg = sum / sorted.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
  const max = sorted[sorted.length - 1];
  return { avg, p95, max };
}

function report(label: string, samplesMs: number[]) {
  const { avg, p95, max } = stats(samplesMs);
  console.log(
    `${label}: n=${samplesMs.length} avg=${(avg * 1000).toFixed(2)}us p95=${(p95 * 1000).toFixed(2)}us max=${(max * 1000).toFixed(2)}us`,
  );
}

async function main() {
  await ensureRapierReady();
  const physics = buildPlayerPhysics(LEVEL30_UNLOCKED_AREAS, 0, 6.25);

  // 1) resolveMovement: at least 1000 calls, simulating a full second+ of
  // continuous walking with varied small per-step deltas (never a straight
  // line — direction wanders like a real gamepad/keyboard input would).
  const moveSamples: number[] = [];
  const totalSteps = 1800; // 30 simulated seconds at 60Hz, comfortably >1000
  let heading = 0;
  for (let step = 0; step < totalSteps; step += 1) {
    heading += (Math.random() - 0.5) * 0.6;
    const speed = 2 + Math.random() * 4; // layout units/sec, varied walking pace
    const dx = Math.cos(heading) * speed * PHYSICS_STEP;
    const dz = Math.sin(heading) * speed * PHYSICS_STEP;
    const start = performance.now();
    physics.resolveMovement(dx, dz);
    moveSamples.push(performance.now() - start);
  }
  report("resolveMovement", moveSamples);

  // 2) updateDoors: cheap, called every frame alongside resolveMovement, but
  // timed separately since it moves 4 leaf colliders every call.
  const doorSamples: number[] = [];
  for (let i = 0; i < 200; i += 1) {
    const progress = (i % 100) / 100;
    const start = performance.now();
    physics.updateDoors(progress, progress);
    doorSamples.push(performance.now() - start);
  }
  report("updateDoors", doorSamples);

  // 3) setUnlockedAreas: rare (one purchase), but rebuilds ~20+ colliders —
  // worth knowing the one-off cost even though it's not a per-frame call.
  const unlockSamples: number[] = [];
  const progressiveAreaSets = [
    [],
    ["store-floor", "purchase-campaign"],
    ["store-floor", "purchase-campaign", "checkout-2", "checkout-3"],
    LEVEL30_UNLOCKED_AREAS,
  ];
  for (const areas of progressiveAreaSets) {
    const start = performance.now();
    physics.setUnlockedAreas(areas);
    unlockSamples.push(performance.now() - start);
  }
  report("setUnlockedAreas", unlockSamples);

  physics.dispose();

  console.log("\nFrame budget context: 60 FPS gives ~16.7ms shared across rendering, animation and this movement resolution.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
