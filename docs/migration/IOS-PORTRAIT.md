# Native iOS portrait presentation — 2026-09-20

## Cause and correction

The previous iOS export inherited `window/handheld/orientation=4` (sensor landscape). Its generated Info.plist allowed both landscape orientations. The native window also used physical pixels as UI units and returned no safe-area insets. At a wide aspect ratio, the original orthographic camera formula necessarily displays much more horizontal world space; changing camera distance or inventing a new zoom multiplier would hide the cause.

The `.ios` project overrides now require portrait (enum 1), with a startup logical reference of 430×932. Runtime sizing replaces that reference with `window.size / DisplayServer.screen_get_scale()` on every window size change. `canvas_items` keeps the UI in logical points and the backing buffer at native density. The renderer and character responsive policies receive that same logical width. This is not a fixed-width layout or a fixed iPhone aspect ratio.

The iOS preset preserves bundle ID `app.olcas.market`, iPhone arm64, unsigned project export and version 1.0.0; build number is 2. The workflow checks both generated and compiled Info.plists for portrait-only orientations, including any device-specific overrides. Desktop and Web configuration is preserved: the source PWA manifest itself allows `orientation: any`.

## Mathematical camera parity

`MarketScene.tsx::OverviewCamera` uses **OrthographicCamera**, not a perspective camera; a perspective FOV therefore does not apply. Godot uses `Camera3D.PROJECTION_ORTHOGONAL`, explicitly `KEEP_HEIGHT`:

| Property | Original and native |
|---|---|
| Initial player world position | `(0, 0, 37.5)` |
| Overview target | `(player.x, 4.455, player.z)` |
| Camera offset from target | `(48, 69, 77.25)` |
| Near / far | `0.3 / 360` |
| Overview zoom | `min(width / 32, height / 28.5) / 1.15 * 1.3` |
| Checkout zoom | `min(width / 10, height / 10) * 1.3` |
| Godot vertical span | `height / interpolated_zoom` |
| Startup zoom | `1`, as in Three.js |
| Zoom interpolation | `1 - exp(-5 * clamp(delta, 0, 0.05))` |
| Checkout blend response | `4.8` entering, `3.2` leaving |

At 430×932, settled overview horizontal span is 28.307692 world units. Safe areas never enter these camera calculations. Vertical target ignores physics body height, as the original does. Checkout coordinates continue to come from the ported checkout layout with the original store/world scales.

`scripts/export-godot-camera-oracles.mjs` extracts and executes the **unchanged original component frame callback**, its source constants, and imported TS layout/locomotion helpers against real Three.js. Only the React hook adapter is provided by the harness. The Godot regression test calls the production camera update and uses `Camera3D.unproject_position` for six landmarks. It covers 1,827 frames across 430×932, 390×844, 393×852, 360×640, 375×667, 768×1024 and 1280×720, including startup, movement, long frames and checkout entry/exit. Maximum observed landmark error: **0.001728 logical pixels**, below the 0.01-pixel assertion.

## Native safe areas

Godot 4.7.2's Apple display server reports UIKit `safeAreaInsets` in physical screen pixels. These are converted into logical viewport insets for existing HUD and panel consumers, plus the authentication scroll area. The camera continues to use the entire window. Regression fixtures cover a 3× display with 59-point top / 34-point bottom insets, a screen without an inset, and side insets. These are test inputs, not hardcoded device padding. Runtime reads the actual platform values.

The headless Retina-window integration test creates a 1290×2796 backing window, asserts its visible viewport is 430×932, and verifies a uniform 3× canvas transform. Physical display information comes from [Apple's iPhone 15 Pro Max specifications](https://support.apple.com/en-au/111828); pixel/point and safe-area semantics were checked in the [Godot 4.7.2 Apple display server](https://github.com/godotengine/godot/blob/4.7.2-stable/drivers/apple_embedded/display_server_apple_embedded.mm).

## Validation

- Godot 4.7.2 headless: **94 suites / 408 tests passed**.
- TypeScript: **93 suites / 870 tests passed**.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: passed. Lint retains the pre-existing unused `FARM_BARN` warning in `engine.test.ts`; no test was weakened or changed to suppress it.
- Real Linux Vulkan/Mobile renderer: rendered world and HUD at 430×932 without errors. The screenshot tool uses an offscreen viewport so the desktop window manager cannot truncate a tall phone reference.
- Actual source Three.js render and native render of the same campaign fixture were visually compared at 430×932: matching door/player/fixture framing and apparent scale. These are scene captures, not a claim of pixel-identical shading or physical-iPhone rendering.
- Local iOS Xcode export: passed; generated Info.plist is portrait-only. Linux emits the expected warning that Xcode compilation/IPA packaging requires macOS, and the existing exporter warning for `application/boot_splash/fullsize`.
- Workflow syntax: actionlint passed. The macOS workflow performs the final unsigned arm64 build, validates the built app's portrait Info.plist, and publishes `MiniMarket.ipa`.

Reproduce the projection oracle with `node scripts/export-godot-camera-oracles.mjs`, then `pnpm godot:test test_market_world`. Display/Retina regression coverage is `pnpm godot:test test_display_metrics`. Local evidence is under ignored `.migration-validation/portrait-*`.

**Physical iPhone installation, launch orientation, Dynamic Island avoidance, touch coordinates and suspend/resume remain NOT_RUN on actual hardware.** The viewport, projection, configuration and native build checks do not substitute for those checks. No game rules, assets, economy or backend behavior were changed. The existing native backend URL configuration remains outside this presentation correction.
