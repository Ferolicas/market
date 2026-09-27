import * as THREE from "three";

/**
 * `/runtime`'s `worldKit` path only — never imported by `/` (`MarketScene.tsx`)
 * or `/play2`'s non-`worldKit` branch of `ClientRuntime`. Fixes the real
 * regression found on the iPhone 15-minute playtest: the store's shell and
 * every fixture/furniture piece already gets its shader PROGRAM precompiled
 * ahead of the first frame (`renderer.compile()` in `ClientRuntime.finishReady`),
 * but that call never uploads TEXTURE data to the GPU — `WebGLRenderer.compile`
 * only builds/links programs (`prepareMaterial` → `getProgram`), texture pixel
 * upload happens lazily inside `renderer.render()`, the first time a material
 * that references it is actually drawn. Any object outside the camera frustum
 * at the moment `finishReady()` renders its first frame from `PLAYER_START` —
 * i.e. almost the whole store except what's immediately visible at spawn —
 * still pays that upload cost the first time the player walks it into view.
 * The effect compounds for content that streams in AFTER the first playable
 * frame on purpose (crowd bodies/hats/delivered products, farm animals,
 * environment props — see `ClientRuntime.loadDeferredWorldKitAssets` and
 * `WorldKit/farm/animalStation.ts`): those materials are never precompiled
 * OR texture-uploaded by anything, so their first real render — almost
 * always the moment the player gets close enough to see them, i.e. "the
 * first time you enter a section" — pays for shader link AND texture upload
 * in the same frame. Confirmed with Playwright + a WebGL2 instrumentation
 * harness (`scripts/qa-runtime-first-visit-hitch.mts`, before/after evidence
 * in `docs/PROJECT-MAP.md`): `gl.compileShader`/`gl.linkProgram`/
 * `gl.texImage2D` calls cluster exactly at first-visit frames, never on a
 * revisit.
 */

/** Every texture-valued property a `THREE.Material` subclass used anywhere
 * in this codebase might carry. Kept as a flat list (not a per-material-type
 * switch) so a new WorldKit material never silently skips warm-up. */
const TEXTURE_KEYS = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap",
  "alphaMap", "bumpMap", "displacementMap", "lightMap", "envMap",
  "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap",
  "sheenColorMap", "sheenRoughnessMap", "specularMap", "specularColorMap",
  "specularIntensityMap", "transmissionMap", "thicknessMap",
  "iridescenceMap", "iridescenceThicknessMap", "anisotropyMap", "gradientMap",
] as const;

type WarmRoot = THREE.Object3D | readonly THREE.Object3D[];

function forEachRoot(root: WarmRoot, visit: (object: THREE.Object3D) => void) {
  for (const object of Array.isArray(root) ? root : [root]) (object as THREE.Object3D).traverse(visit);
}

function collectTextures(root: WarmRoot): THREE.Texture[] {
  const found = new Set<THREE.Texture>();
  forEachRoot(root, (object) => {
    const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    for (const one of Array.isArray(material) ? material : [material]) {
      const record = one as unknown as Record<string, unknown>;
      for (const key of TEXTURE_KEYS) {
        const value = record[key];
        if (value instanceof THREE.Texture) found.add(value);
      }
    }
  });
  return [...found];
}

/** Uploads every texture found under `root` to the GPU right away
 * (`renderer.initTexture` — idempotent, a texture already uploaded is a
 * cheap version-check no-op). Only for the curtain-time warm-up
 * (`ClientRuntime.finishReady`), where blocking a little longer before
 * `onReady()` is exactly the point — never call this after the game has
 * already declared itself interactive. */
export function warmUpTexturesNow(renderer: THREE.WebGLRenderer, root: WarmRoot): void {
  for (const texture of collectTextures(root)) {
    try { renderer.initTexture(texture); } catch { /* a torn-down texture must never break warm-up */ }
  }
}

type IdleDeadline = { timeRemaining(): number; didTimeout: boolean };
type IdleWindow = Window & { requestIdleCallback?: (callback: (deadline: IdleDeadline) => void, options?: { timeout: number }) => number };

/** Same upload as `warmUpTexturesNow`, but spread across `requestIdleCallback`
 * slices (falling back to a `setTimeout` chunk on browsers without it, e.g.
 * iOS Safari) so a batch of newly-arrived textures never itself becomes a
 * frame hitch. Used for content that streams in AFTER the game is already
 * interactive — the one place genuinely-idle time, not the loading curtain,
 * is where this cost belongs. */
export function warmUpTexturesIdle(renderer: THREE.WebGLRenderer, root: WarmRoot, chunkBudgetMs = 3): void {
  const textures = collectTextures(root);
  if (textures.length === 0) return;
  let index = 0;
  const runChunk = (deadline?: IdleDeadline) => {
    const start = performance.now();
    while (index < textures.length && (deadline ? deadline.timeRemaining() > 0 : performance.now() - start < chunkBudgetMs)) {
      const texture = textures[index];
      index += 1;
      try { renderer.initTexture(texture); } catch { /* a torn-down texture must never break warm-up */ }
    }
    if (index < textures.length) schedule();
  };
  const schedule = () => {
    const idleWindow = window as IdleWindow;
    if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback((deadline) => runChunk(deadline), { timeout: 200 });
    else window.setTimeout(() => runChunk(), 0);
  };
  schedule();
}

/**
 * 2026-09-27 tail-latency fix: an earlier version of this module
 * (`warmUpShaders`/`warmUpNewContent`, now removed) dispatched
 * `renderer.compileAsync()` but never waited for it — every deferred loader
 * used to call it AFTER already attaching `root` to the live scene
 * (`this.layoutRoot.add(...)` before the warm-up call). Real evidence
 * (`FrameAttribution`, a 6-minute throttled `/runtime` session,
 * 2026-09-27): the single worst two frames recorded (215.6ms and 170.2ms
 * `workMs`, ~97% of it inside `renderer.render()` itself) both landed
 * exactly during the post-ready crowd-body streaming window, each carrying
 * 32-36 real `gl.compileShader` and 16-18 `gl.linkProgram` calls in that one
 * frame — `compileAsync` was still in flight (or had not even been awaited
 * anywhere) when the object was already a scene child close enough to the
 * camera to actually get drawn, so three.js fell back to its normal
 * synchronous "compile the program the first time it's used" path, right
 * inside that frame's `render()` call. `compileAsync` needs a scene
 * reference for lighting/fog context, not scene MEMBERSHIP (`root` need not
 * be attached yet) — so every deferred loader now awaits this BEFORE
 * `layoutRoot.add(root)`, guaranteeing the program is already linked before
 * the object can ever be drawn. Texture upload stays on the idle path
 * (`warmUpTexturesIdle`, called after attach, unchanged): the same evidence
 * showed `glTexUploadCount` flat and low (3) even in the worst frames, so
 * shader compile — not texture upload — was the real, dominant, fixable
 * cost here. */
export async function warmUpShadersBeforeAttach(renderer: THREE.WebGLRenderer, root: WarmRoot, camera: THREE.Camera, scene: THREE.Scene): Promise<void> {
  await Promise.all((Array.isArray(root) ? root : [root]).map((object) => renderer.compileAsync(object, camera, scene).catch(() => {})));
}
