# Porting conventions (Three.js/TypeScript → Godot 4.7 / GDScript)

Goal: a native Godot version of Mini Market with **identical rules, state and
behaviour** to `src/` (the web version). The server (`/api/game/save`) keeps
validating saves, so the JSON shape of the game state must stay byte-for-byte
compatible with `src/game/types.ts`.

## Files and names
- One TS module → one GDScript file at the same relative path under `godot/game/`,
  file name in snake_case, `class_name` in PascalCase of the module name:
  `src/game/stations/retail-layout.ts` → `godot/game/stations/retail_layout.gd`,
  `class_name RetailLayout`. `src/game/engine.ts` → `godot/game/engine.gd`,
  `class_name Engine`... **no**: `Engine` is a Godot singleton; use `MarketEngine`.
  Other reserved names to avoid: `Input`, `Time`, `Performance`, `JSON`, `OS`,
  `Engine`, `Geometry2D`, `Node`, `Timer`. When a name collides, prefix `Market`.
- Every exported TS function becomes a `static func` in snake_case
  (`applyGameAction` → `apply_game_action`). Exported constants keep their
  UPPER_SNAKE name as `const`. Non-exported helpers become `static func _name`.
- Every `*.test.ts` becomes `godot/tests/<same path>/test_<module>.gd`,
  `extends TestCase`, one `test_*` method per `it(...)`. Keep the `it` text as
  the method name (snake_case, shortened). Port every test; do not drop cases.
- Shared helpers with JavaScript semantics live in `godot/game/util/js.gd`
  (`class_name JS`): `JS.round` (Math.round), `JS.find`, `JS.some`, `JS.clone`,
  `JS.slice`, `JS.pad_start`, `JS.to_fixed`, `JS.now_ms`, `JS.iso_now`, ...
  Add helpers there if you need more JS semantics, never duplicate them.

## Data model
- TS interfaces/objects → `Dictionary` with the **same camelCase keys** as the
  JSON (`balanceMinor`, `checkoutTransactions`, ...). Enum-like string unions stay
  strings ("IDLE", "cash", "farmer"). Tuples `[x, z]` → `Array` `[x, z]`.
  `WorldPosition` `[x, y, z]` → `Array` (not Vector3) inside layout constants so
  they match the TS tables exactly; convert to `Vector3` only in scene code.
- `undefined`/missing optional → `dict.get("key")` returns `null`; use
  `JS.get_or(dict, "key", default)` for `??` defaults.
- Numbers: money is `int` (minor units). Timestamps are ms (`int`). Use `float`
  where TS uses fractions. Beware integer division: `a / b` with two ints
  truncates in GDScript; write `float(a) / b` where TS produced a fraction.
  `Math.round` → `JS.round` (half-up), `Math.floor` → `floori`/`JS.floor`.
- Immutability: the TS engine never mutates its input state (spreads /
  structuredClone). In GDScript, deep-copy the input at the entry of any
  function that returns a new state (`var state = JS.clone(input)`), mutate the
  copy, return it. Never mutate arguments.
- `throw new Error("CODE")` → `push_error("CODE")` and return a failure value
  (`null`, or `{ "ok": false, "message": "CODE" }` where the TS API returns
  ActionResult). Tests that used `toThrow` assert on that failure value.
- `Math.random()` → `randf()`; where TS accepts an injectable RNG/`now`
  parameter keep it injectable so tests stay deterministic.
- Three.js math → Godot: `Vector3`, `Quaternion`, `Basis`, `Transform3D`.
  Three's `MathUtils.lerp/damp/clamp` → `lerpf`, `clampf`, `move_toward`.
  Note Three and Godot are both +Y up, -Z forward. No axis conversion.
  Yaw in TS is `rotation.y`; in Godot `rotation.y` too.

## Style
- Static typing where cheap (`-> Dictionary`, `: int`), `Variant` where the TS
  used unions. Keep the TS comments that explain a rule; drop React/Three ones.
- No autoloads in pure logic. No `Node` usage in `godot/game/**` except
  `godot/game/render/**` and `godot/game/feedback/game_audio.gd` which are
  explicitly scene-facing.
- Run the tests with `GODOT=<binary> tools/test.sh [filter]` from `godot/`.
  Test runner: `tests/run_tests.gd`, base class `tests/test_case.gd`.