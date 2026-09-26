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

/** Dispatches non-blocking shader compilation for every material under
 * `root`, using the real live `scene` so lighting/fog match what will
 * actually be rendered — the exact use the source documents for
 * `WebGLRenderer.compile`'s third parameter ("If you want to add a 3D
 * object to an existing scene, use the target scene parameter"). Cheap even
 * called often: scoped to just `root`'s own materials (not a whole-scene
 * traversal), and an already-linked program is reused, never recompiled. */
export function warmUpShaders(renderer: THREE.WebGLRenderer, root: WarmRoot, camera: THREE.Camera, scene: THREE.Scene): void {
  for (const object of Array.isArray(root) ? root : [root]) {
    void renderer.compileAsync(object as THREE.Object3D, camera, scene).catch(() => {});
  }
}

/** The one call site every deferred WorldKit loader (crowd bodies/hats/
 * delivered products, farm animals, environment props) makes the instant
 * its new content attaches to the live scene — see the module doc comment
 * for why this is the actual fix, not a relocation of the same stall. */
export function warmUpNewContent(renderer: THREE.WebGLRenderer, root: WarmRoot, camera: THREE.Camera, scene: THREE.Scene): void {
  warmUpShaders(renderer, root, camera, scene);
  warmUpTexturesIdle(renderer, root);
}
