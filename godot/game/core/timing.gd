class_name Timing
extends RefCounted
## Port of src/game/core/timing.ts.

## World AI/economy is delta-time based and does not need to clone/reconcile
## the complete save ten times per second. Visual player motion and physics
## remain at 60 Hz while the authoritative world advances at a stable 5 Hz.
const WORLD_TICK_INTERVAL_MS := 200
## Never extrapolate an NPC farther than 300 ms from an authoritative path
## snapshot. This still bridges a normal 200 ms world tick without allowing a
## delayed tab/task to project a character through a waypoint.
const CUSTOMER_VISUAL_HORIZON_MS := 300
