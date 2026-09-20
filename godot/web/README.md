# Godot 4.7.2 Web platform adaptations

The original WASM templates are retained. `scripts/export-godot.mjs` applies a
checked integration to the template's JavaScript context registration and loads
`context-recovery.js` before the engine. Unknown template layouts fail export.
No game rules execute in these adapters.

## Context recovery

`context-recovery.js` retains CPU copies of live GPU buffers and texture uploads,
shader sources, program uniforms, vertex arrays, attachments, samplers and GL
state. Upload offsets and pixel packing are retained; it does not copy the whole
WASM heap or record a growing list of frames. Emscripten's object identities stay
stable while their underlying WebGL objects are reconstructed.

On context loss, preventDefault permits browser restoration. The adapter holds
Emscripten's keepalive while pausing the loop and requests restoration after
750 ms, as the original game does. On restoration it reacquires extensions,
rebuilds resources in dependency order, checks GL errors, then resumes the same
runtime. It never reloads the page or recreates game state. Native wall-clock
world ticks retain the original elapsed-time cap across stalls.

The adapter emits `marketwebgllost` / `marketwebglrestored` only on real lifecycle
events; the active game telemetry owner sends the original authenticated events.
A reconstruction error is reported and is not treated as a successful restore.

Observed in the initial campaign: about 126 MiB of additional CPU mirrors,
20,727 live resource objects, and approximately 145–152 ms for GPU reconstruction
on the local RTX 4080 SUPER/Chrome. These are measurements, not mobile guarantees.

## Verification

- `node scripts/test-godot-gpu-recovery.mjs`: actual WebGL2 resource tests, three
  losses and exact pixel equality; deleted attached shaders, WASM upload offsets,
  RGBA/two-channel font textures, uniforms, VAO, framebuffer and depth renderbuffer.
- `MARKET_QA_WEB=1 MARKET_QA_CONTEXT_ONLY=1 node scripts/qa-godot-live-api.mjs`:
  real game, two automatic restorations, image comparison, no navigation/runtime
  replacement, persistent player/economy, keyboard physics, telemetry HTTP 201
  and authoritative save afterward.
- Add `MARKET_QA_JOURNEY=1 MARKET_QA_CONTEXT=1` to full Web QA for the physical
  first-sale journey, PWA offline/reconnection and subsequent context recovery.

`service-worker.js` caches the complete export, including the recovery adapter.
The PCK is stored in 8 MiB entries; its manifest is committed only when all bytes
have been written. Authenticated APIs never enter that cache.
