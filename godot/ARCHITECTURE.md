# Godot port — architecture

Same game, same rules, same save format as the web version (`src/`). This file
maps every React/Three.js piece onto Godot 4.7 nodes so the scene layer stays
a thin presenter over the ported pure logic in `godot/game/**` (see PORTING.md).

## Units and scales (identical to the web build)
- Layout units: every table in `godot/game/stations/*` is authored in layout
  units. `WorldScale.STORE_LAYOUT_SCALE` (2) scales positions, and
  `STORE_ELEMENT_SCALE` (1.6) scales furniture pieces; `WORLD_SCALE` (3) scales
  the whole scene group (characters were authored for that size).
- Scene tree mirrors Three: `World` (Node3D, scale = WORLD_SCALE) ⊃
  `Ground`/`City`/`Building` (scale = [LAYOUT, 1, LAYOUT]) and `Furniture`/`Farm`
  (children positioned with `scale_store_position`, pieces scaled by
  STORE_ELEMENT_SCALE). Characters are children of `World` at
  `characterSceneScale(body) * WORLD_SCALE`.
- Physics and interaction run in *world* units (layout × LAYOUT × WORLD_SCALE),
  exactly as the Rapier colliders did in `MarketScene.tsx`. Interaction zones
  are evaluated in "scaled layout" units (layout × LAYOUT) by
  `InteractionDirector.update(actor, x, z, now_ms)` — positions divided by
  WORLD_SCALE, as in the TS.
- Axes: Three and Godot are both +Y up / −Z forward. No conversion anywhere.
  Yaw in TS is `rotation.y`; in Godot `rotation.y` too.

## Autoloads (project.godot [autoload])
- `GameStore` (`res://game/store.gd`) — port of `src/game/store.ts` +
  `GameRuntime.tsx`: holds `game` (Dictionary), `save_revision`, `save_status`,
  `message`, `pending_events`; `dispatch(action)`, `queue_interaction(action)`,
  `record_player_distance(m)`, `tick_world(delta_ms)` on a 200 ms timer
  (`Timing.WORLD_TICK_INTERVAL_MS`), `save_game()` every 30 s and on
  focus-out/quit, `load_game()`, `adopt_local_copy()`, `restore_server_copy()`.
  Emits `game_changed`, `message_changed(message, revision)`,
  `save_status_changed`. Recovery snapshot → `user://recovery-<release>.json`
  written at most every 3 s (RecoveryStorage semantics).
- `MarketApi` (`res://game/net/market_api.gd`) — HTTP client for
  `https://market.olcas.app` (configurable `MARKET_API_BASE` in
  `res://game/config/runtime_config.gd`): Better Auth email/username
  sign-in/sign-up/sign-out (`/api/auth/sign-in/email`, `/api/auth/sign-in/username`,
  `/api/auth/sign-up/email`, `/api/auth/get-session`, `/api/auth/sign-out`),
  cookie jar persisted in `user://session.cfg` (cookie prefix `market`),
  `GET/PUT /api/game/save` with header `x-market-release: <CAMPAIGN_RELEASE>`,
  `POST /api/game/telemetry`. All async via `HTTPRequest`, returning
  `{ status, json }`.
- `FeedbackBus` (`res://game/feedback/feedback_bus.gd`) and `GameAudio`
  (`res://game/feedback/game_audio.gd`) — cues → samples.
- `AudioSettingsStore` — persisted preference.
- `MarketInput` (`res://game/input/input_manager.gd` wrapper node) — keyboard
  (WASD/arrows), gamepad, and the on-screen drag joystick feed the pure
  `InputManager.sample()`.

## Scenes
- `scenes/main.tscn` (`Main` — port of `page.tsx` + `LoadingCurtain`): shows
  the loading curtain, checks the session (`MarketApi.get_session`), shows
  `AuthScreen` or `GameShell`; offline with a recovery hint → GameShell with the
  cached player name (`user://offline-player.cfg`).
- `scenes/auth_screen.tscn` — login / register / forgot (same texts).
- `scenes/game_shell.tscn` (`GameShell.tsx`): SubViewport-free layout — the
  3D `MarketScene` fills the window, a `CanvasLayer` holds the HUD (level, money,
  mission strip, quick buttons, panels: management/team/settings/finances,
  sound panel, save badge, conflict dialog, LevelOneGuide, SetupPanel with the
  avatar customizer, MissionComplete overlay). Same strings, same panel logic.
- `scenes/market_scene.tscn` (`MarketScene.tsx`): 
  - `Camera3D` orthographic (port of `OverviewCamera`): position = focus +
    `OverviewCamera.OVERVIEW_CAMERA_OFFSET` (× WORLD_SCALE), look-at focus,
    `size` derived from the Three zoom formula: Three ortho with zoom z shows
    `viewport_height / z` world units vertically, so `camera.size = viewport_h / zoom`
    with `zoom = min(w/32, h/28.5) / 1.15 * 1.3`; checkout blend identical.
  - `WorldEnvironment`: background/fog colours from `BusinessDay.daylight_presentation`,
    fog 62·WS → 105·WS; ambient from `ambientIntensity`; key
    `DirectionalLight3D` at (8,13,7)·WS with shadows (2048 desktop / 1024 mobile).
  - `Ground`, `City` (`CityPerimeter`), `Building` (walls, storefront glass and
    the animated double door), `Furniture` (`KitFurniture`), `Farm` (`KitFarm`),
    `Employees`, `Customers`, `Player`, `Bursts` (magnet particle flights),
    `Markers` (purchase squares, register cash stacks).
  - Static colliders: `StaticBody3D` with `BoxShape3D`s from
    `WorldScale.store_obstacles_for_areas(areas)` + the wall list in
    `StoreColliders`; door leaves are `AnimatableBody3D` moved every frame.
  - Player: `CharacterBody3D` + `CapsuleShape3D` (radius 0.24·WS, half-height
    0.45·WS, centre y 0.69·WS), moved with `move_and_slide` in `_physics_process`
    at 60 Hz using `PlayerController.move_velocity`; heading smoothing in
    `_process` (`smooth_yaw`). Distance reported via `GameStore.record_player_distance`.
    Interaction: `InteractionDirector` fed with player position every physics
    step; `WorkstationController` locks movement at hands-on stations. No
    Area3D sensors are needed: the director is pure and position-based.
  - Customers/employees: `Node3D` actors driven by `LiveActors` snapshots and
    `CustomerVisualMotion.project_customer_motion`; bodies from
    `assets/models/market/customers|characters/**` with LOD tiers by distance
    (`VisibilityRange` or manual swap) reproducing `CharacterPresentation` tiers.
  - Navigation: `NavigationRegion3D` baked at runtime from the walkable geometry
    (`NavMeshService.create_walkable_store_geometry` → `ArrayMesh` →
    `NavigationMesh` bake with agent radius as in the TS) whenever
    `structureRevision`/`unlockedAreas` change; `store_pathfinder(start, end)`
    → `NavigationServer3D.map_get_path` in layout units. Fallback: straight
    line when the map is not ready (same as the TS fallback).
  - Text in world: `Label3D` (font `assets/fonts/OpenSans-SemiBold.ttf`) in
    place of drei `Text`; billboard off, same yaw rules (`FLOOR_LABEL_YAW`).
  - Transparent glass: `StandardMaterial3D` with transparency (alpha) and
    `refraction` off on mobile (the web halved the transmission buffer).
- `scenes/actors/avatar.tscn` (`Avatar.tsx` + `CharacterAccessories.tsx`):
  loads the body GLB for `body`, recolours Skin/Shirt/Hair materials, attaches
  hair/hat GLBs to the `Head` bone via `BoneAttachment3D`, plays clips through
  `AnimationPlayer` with the crossfades from `LocomotionController`; morph
  targets via `MeshInstance3D.set_blend_shape_value` (FacialController).
- `scenes/actors/customer.tscn` (`Customer.tsx`): body + cart (MultiMesh for
  casters/wheels) + basket/bag, animation choice `customer_animation(...)`.
- `scenes/props/harvest_basket.tscn` (`HarvestBasket.tsx`): basket +
  per-product primitive stacks (`BasketProduct`).

## Mobile performance rules (from the web profile, `AdaptiveQuality`)
- Mobile renderer, MSAA off, shadows 1024 on handhelds, static shadow refresh,
  LOD1/LOD2 bodies for crowds beyond the tiers in `CharacterPresentation`,
  MultiMeshInstance3D for repeated products, carts, cash bundles and city
  props (port of `StaticMeshBatch` intent), `Viewport.scaling_3d_scale` driven
  by `AdaptiveQuality.advance_adaptive_quality` (DPR steps → scaling steps).
- Never allocate per frame in `_process` of actors; reuse arrays.

## Exports
`export_presets.cfg`: Android (arm64-v8a, Vulkan/GLES3 fallback, portrait+landscape),
iOS (Metal), Linux/Windows/macOS desktop. App id `app.olcas.market`.
