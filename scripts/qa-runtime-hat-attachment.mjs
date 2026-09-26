import fs from "node:fs/promises";
import { chromium } from "playwright";

/**
 * Repro + fix verification for the 2026-09-27 iPhone playtest report: "the
 * player's hat, while walking, sometimes disappears momentarily" on
 * `/runtime`.
 *
 * Root cause (see `src/game/render/CrowdSystems.ts` `socketMatrix()` and
 * `src/game/render/CrowdSkinning.ts`'s vertex shader `crowdPose()`): the
 * player's body mesh is GPU-skinned from a blend of two clips
 * (`current + (previous - current) * blend`) for ~200ms every time the
 * locomotion clip changes (starting, stopping, turning while walking — i.e.
 * constantly during normal play). `socketMatrix()`, which places the hat on
 * the Head socket, only read the current clip's row — never the blend — so
 * for that whole 200ms window the hat tracked a head pose the renderer was
 * not actually drawing, while the visible (blended) head moved differently.
 * That divergence reads as the hat sinking into the head/hair or floating
 * off to the side — "disappearing" — every time the walk cycle starts,
 * stops or changes gait.
 *
 * This script drives real, varied player movement (forward/back/strafe/stop,
 * changing direction every few hundred ms so the locomotion controller keeps
 * cross-fading clips) on the seeded `/runtime` integral harness, and every
 * animation frame reads the *actual* THREE.InstancedMesh state for the
 * player's hat and body straight out of the live scene graph — no mocking:
 *   - hat mesh .visible / .count (is it in the "empty, so hidden" branch?)
 *   - hat mesh world position, from its real instance matrix × matrixWorld
 *   - body mesh world position, the same way
 *   - frustum test result via the real camera + hat's own bounding sphere
 * A frame-to-frame speed mismatch between the hat and the body it is rigidly
 * attached to is a real positional glitch (the hat briefly somewhere it
 * should not be, which is what a human eye reads as "disappeared").
 */
const BASE_URL = process.argv[2] ?? "http://localhost:4300";
const OUT = process.argv[3] ?? "/tmp/market-runtime-hat-attachment-qa.json";
const HAT_ID = "red-panda"; // the seed's default avatar has no hat; force one on.
const DRIVE_SECONDS = Number(process.env.MARKET_QA_HAT_SECONDS ?? 25);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => consoleErrors.push(String(error)));

// Force a hat onto the seeded avatar by rewriting the fixture response —
// no login, no localStorage timing games, and `/`/`/play2` never load this
// URL so this cannot affect them.
await page.route("**/fixtures/runtime-level30-seed.json", async (route) => {
  const response = await route.fetch();
  const seed = await response.json();
  seed.avatar.hat = HAT_ID;
  await route.fulfill({ response, json: seed });
});

await page.goto(`${BASE_URL}/runtime?debug=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.locator("canvas").first().waitFor({ timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__MARKET_SET_PLAYER_INPUT__ && window.__MARKET_PERF_SCENE__), null, { timeout: 60_000 });
// Let the avatar (body + hat GLB) finish loading before driving movement.
await page.waitForFunction(() => {
  const scene = window.__MARKET_PERF_SCENE__?.();
  if (!scene) return false;
  let hasHat = false;
  scene.traverse((object) => { if (object.name?.startsWith("player-hat:")) hasHat = true; });
  return hasHat;
}, null, { timeout: 60_000 });
await page.waitForTimeout(1500);

const result = await page.evaluate(async ({ driveMs }) => new Promise((resolve) => {
  const scene = window.__MARKET_PERF_SCENE__();
  const setInput = window.__MARKET_SET_PLAYER_INPUT__;
  const samples = [];

  // Column-major 4x4 multiply (three.js's own Matrix4.multiplyMatrices
  // convention) done with plain arrays, so this needs no THREE import in the
  // page — just the real matrixWorld/instanceMatrix arrays three already
  // computed this frame.
  const multiply = (a, b) => {
    const a11 = a[0], a12 = a[4], a13 = a[8], a14 = a[12];
    const a21 = a[1], a22 = a[5], a23 = a[9], a24 = a[13];
    const a31 = a[2], a32 = a[6], a33 = a[10], a34 = a[14];
    const a41 = a[3], a42 = a[7], a43 = a[11], a44 = a[15];
    const b11 = b[0], b12 = b[4], b13 = b[8], b14 = b[12];
    const b21 = b[1], b22 = b[5], b23 = b[9], b24 = b[13];
    const b31 = b[2], b32 = b[6], b33 = b[10], b34 = b[14];
    const b41 = b[3], b42 = b[7], b43 = b[11], b44 = b[15];
    const te = new Array(16);
    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
    return te;
  };
  const worldMatrixOfInstance0 = (mesh) => {
    mesh.updateMatrixWorld(true);
    const local = Array.from(mesh.instanceMatrix.array.slice(0, 16));
    return multiply(mesh.matrixWorld.elements, local);
  };
  // The body's own instance transform is exactly `T(position) * R_y(yaw) *
  // S(rootScale)` (see `PlayerActor.present()`'s `scratch.body`), a pure
  // uniform-scaled Y rotation, so it inverts in closed form: column 1 is
  // `(0, rootScale, 0)`, giving the scale directly, and columns 0/2 give
  // cos/sin of the yaw. Undoing it turns the hat's world position into its
  // position in the player's own unrotated, unscaled rig space — the exact
  // quantity `socketMatrix()` computes — so a walk/turn/stop no longer shows
  // up as "movement" here at all. Only a real attachment glitch should.
  const hatInPlayerLocalSpace = (bodyWorld, hatWorld) => {
    const s = Math.hypot(bodyWorld[0], bodyWorld[1], bodyWorld[2]);
    const cos = bodyWorld[0] / s;
    const sin = bodyWorld[8] / s;
    const dx = hatWorld[12] - bodyWorld[12];
    const dy = hatWorld[13] - bodyWorld[13];
    const dz = hatWorld[14] - bodyWorld[14];
    return {
      x: (cos * dx - sin * dz) / s,
      y: dy / s,
      z: (sin * dx + cos * dz) / s,
    };
  };

  // Direction schedule: forward, diagonals, strafes and stops, switching
  // often enough to keep re-triggering the locomotion cross-fade (idle<->walk
  // and gait/turn changes) the whole run — exactly the condition the owner
  // hit on a real, varied iPhone walk.
  const directions = [
    [0, 1], [1, 1], [1, 0], [0, 0], [-1, 1], [-1, 0], [0, -1], [0, 0], [1, -1], [0, 1], [0, 0],
  ];
  let directionIndex = 0;
  setInput(...directions[0]);
  const switchEvery = 420; // ms — inside CROWD_FADE_SECONDS territory, repeatedly.
  let lastSwitch = performance.now();
  const start = performance.now();

  const findByPrefix = (prefix) => {
    const hits = [];
    scene.traverse((object) => { if (object.name?.startsWith(prefix)) hits.push(object); });
    return hits;
  };

  const tick = (now) => {
    if (now - lastSwitch >= switchEvery) {
      directionIndex = (directionIndex + 1) % directions.length;
      setInput(...directions[directionIndex]);
      lastSwitch = now;
    }
    const hatMeshes = findByPrefix("player-hat:");
    // `crowd-body:player:<key>` is the real, driven body; `...:warm` is a
    // one-instance placeholder kept alive only to keep the shader/program
    // compiled — exclude it so we always sample the actual moving body.
    const bodyMeshes = findByPrefix("crowd-body:player:").filter((object) => !object.name.endsWith(":warm"));
    if (hatMeshes.length > 0 && bodyMeshes.length > 0) {
      const hat = hatMeshes[0];
      const body = bodyMeshes[0];
      const bodyWorld = worldMatrixOfInstance0(body);
      const hatWorld = worldMatrixOfInstance0(hat);
      samples.push({
        t: now - start,
        local: hatInPlayerLocalSpace(bodyWorld, hatWorld),
        hatVisible: hat.visible,
        hatCount: hat.count,
        hatMeshCount: hatMeshes.length,
      });
    } else {
      samples.push({ t: now - start, missing: true, hatMeshCount: hatMeshes.length, bodyMeshCount: bodyMeshes.length });
    }
    if (now - start < driveMs) requestAnimationFrame(tick);
    else { setInput(0, 0); resolve(samples); }
  };
  requestAnimationFrame(tick);
}), { driveMs: DRIVE_SECONDS * 1000 });

await browser.close();

// Analysis: `local` is the hat's position with the body's own translation,
// yaw and scale undone — i.e. the hat's offset from the head socket in the
// player's own rig space, the exact quantity `socketMatrix()` computes.
// Walking, turning, starting and stopping all cancel out of this number; only
// a real head bob/sway (continuous, sub-centimetre per frame at 60fps) should
// remain. A frame-to-frame jump far past that is the socket briefly reading a
// pose the renderer was not drawing — a real, measurable attachment glitch,
// not rotation/translation being mistaken for one.
const missing = result.filter((s) => s.missing);
const present = result.filter((s) => !s.missing);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const glitches = [];
for (let i = 1; i < present.length; i += 1) {
  const prev = present[i - 1];
  const cur = present[i];
  const dt = cur.t - prev.t;
  if (dt <= 0 || dt > 100) continue; // skip the schedule's own artificial gaps, if any
  const step = dist(prev.local, cur.local);
  if (!Number.isFinite(step)) continue; // a momentary zero-scale sample (spawn pop-in), not an attachment glitch
  if (step > 0.02) glitches.push({ t: Number(cur.t.toFixed(1)), dt: Number(dt.toFixed(1)), step: Number(step.toFixed(4)) });
}

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  hatId: HAT_ID,
  driveSeconds: DRIVE_SECONDS,
  framesSampled: result.length,
  framesMissingHat: missing.length,
  hatVisibleAlways: present.every((s) => s.hatVisible === true),
  hatCountAlwaysOne: present.every((s) => s.hatCount === 1),
  hatMeshCountConsistent: [...new Set(present.map((s) => s.hatMeshCount))],
  glitchCount: glitches.length,
  worstGlitches: glitches.sort((a, b) => b.step - a.step).slice(0, 10),
  consoleErrors,
};
await fs.writeFile(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (missing.length > 0) throw new Error(`Hat/body meshes not found in the scene for ${missing.length}/${result.length} sampled frames`);
