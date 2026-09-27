/**
 * Diagnostic-only, opt-in single-variable ablation toggles for the 2026-09-26
 * causal audit of /runtime's iPhone frame-pacing regression (see
 * `docs/RUNTIME-PARITY-INVENTORY.md`): "trabajo" (CPU time inside
 * `ClientRuntime.tick()`) measures fine, but real frame presentation doesn't
 * hold 60 Hz and the device heats up — symptoms of sustained GPU-side cost
 * outside what that CPU timer captures, not a CPU regression.
 *
 * Every flag defaults to OFF (identical to today's shipped behaviour) and is
 * enabled ONLY via `?ablate=<comma-separated-flags>` in the URL — normal
 * `/runtime` traffic is byte-for-byte unaffected. This is instrumentation for
 * measurement, not a fix: nothing here is meant to ship enabled.
 *
 * Flags:
 * - `text`: every `makeText()` call (39 call sites, ~50-100+ live instances
 *   at full level 30 — department signs, checkout screens, machine status,
 *   farm station signs, register/purchase labels) becomes invisible instead
 *   of a real `troika-three-text` SDF mesh. Tests whether replacing the old
 *   `/play2` baseline's `SignLayer` (one draw call, canvas atlas, no SDF, no
 *   per-frame camera-facing bookkeeping) with dozens of individual troika
 *   instances is the/a major GPU-side cost.
 * - `glass`: `MeshPhysicalMaterial.transmission` on both doors (storefront +
 *   rear) is forced to 0. Three.js runs a whole extra background render pass
 *   for any visible `transmission > 0` material, every frame, regardless of
 *   camera position — a well-known expensive feature on mobile GPUs. The old
 *   baseline had NEITHER door (excluded from the static bake, never
 *   replaced) — this transmission glass is 100% new load.
 * - `animals`: live farm-animal stations (`dynamic:farm-animal`) are hidden
 *   entirely. The old baseline had no live animals at all.
 * - `warmup`: disables the GPU warm-up pass added 2026-09-27 for the
 *   "smoother the more you explore" regression (`gpuWarmup.ts` — proactive
 *   `renderer.initTexture`/`renderer.compileAsync` for content that would
 *   otherwise only pay shader-link/texture-upload cost the first time it's
 *   actually rendered). Reverts to the exact pre-fix behaviour (lazy
 *   first-render upload) for A/B comparison; never disabled by default.
 * - `shaderchecks`: forces `renderer.debug.checkShaderErrors` back to
 *   three.js's own default (`true`) for `/runtime`'s worldKit path — see
 *   `ClientRuntime`'s constructor for the real fix this reverts (disabling
 *   it there is the one that actually ships enabled). For A/B comparison
 *   only; never enabled by default.
 */
export interface AblationFlags {
  skipText: boolean;
  skipGlassTransmission: boolean;
  skipAnimals: boolean;
  skipWarmup: boolean;
  forceShaderChecks: boolean;
}

export const ablation: AblationFlags = {
  skipText: false,
  skipGlassTransmission: false,
  skipAnimals: false,
  skipWarmup: false,
  forceShaderChecks: false,
};

/** Call once, before building any WorldKit content, from `ClientRuntime`'s constructor. */
export function configureAblation(search: string) {
  const requested = new Set(new URLSearchParams(search).get("ablate")?.split(",").filter(Boolean) ?? []);
  ablation.skipText = requested.has("text");
  ablation.skipGlassTransmission = requested.has("glass");
  ablation.skipAnimals = requested.has("animals");
  ablation.skipWarmup = requested.has("warmup");
  ablation.forceShaderChecks = requested.has("shaderchecks");
}
