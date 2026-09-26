import * as THREE from "three";
import type { InteractionVisualEvent } from "@/components/game/MarketScene";
import { createHarvestBurst, createPayBurst, createReturnBurst, createStockBurst, type ActiveBurst, type TransferProgressCallback } from "./transferEffects/bursts";

/**
 * Imperative, framework-free port of the four "magnet burst" presentation
 * effects in `MarketScene.tsx` (`HarvestMagnetBurst`, `StockMagnetBurst`,
 * `ReturnMagnetBurst`, `PayMagnetBurst`, ~lines 657-907): small groups of
 * product icons (or cash bundles) flying from a source point to a
 * destination point whenever `GameShell`'s pure presentation ledger
 * (`transferEvents`, `src/game/player/VisualTransferLedger.ts`) records one.
 *
 * This module owns NO economy state. `transferEvents` entries are
 * already-decided facts written by `applyGameAction`/`advanceWorld` before
 * they ever reach here; this only reads them and calls the caller's
 * `onProgress` (the exact same `(sequence, remainingQuantity) => void`
 * contract as `GameShell`'s `updateTransferProgress`) to retire the
 * PRESENTATION-side ledger, exactly like `MarketScene.tsx`'s JSX does.
 *
 * ## Two entry points, matching the source's two different update cadences
 * The source's per-burst `useFrame` runs every rendered frame (advancing
 * particles AND calling `onProgress` the instant a unit's landed-count
 * changes); which bursts exist to render is instead driven by React
 * reconciling `transferEvents` (a plain state array) whenever it changes.
 * `sync()`/`animate()` split along that same line:
 *  - `sync()`: call whenever a fresh `transferEvents` snapshot arrives (i.e.
 *    whatever cadence drives `ClientRuntime.setProps` — not necessarily every
 *    rendered frame). Spawns a burst for every sequence not seen yet and
 *    disposes any tracked burst whose sequence disappeared — the ledger
 *    already retired it, exactly like the source unmounting that
 *    `<XMagnetBurst>` once `updateVisualTransferRemaining` drops the entry.
 *  - `animate()`: call every rendered frame with the real frame delta and the
 *    player's live basket anchor. Advances every active burst's particles and
 *    fires `onProgress` on landing changes — exactly when the source's
 *    `useFrame` would. `GameShell.updateTransferProgress` already coalesces
 *    these to one state update per animation frame on its own side, so
 *    calling it eagerly here from every burst, every frame, costs exactly
 *    what the real client already costs.
 */

export interface TransferEffectsHandle {
  readonly group: THREE.Group;
  /** Spawns/retires bursts for the current `transferEvents` snapshot. Also
   * updates the `unlockedAreas` snapshot and `onProgress` callback used by
   * the next `animate()` calls (a `StockMagnetBurst` needs `unlockedAreas` to
   * resolve which fixture a unit lands on, exactly like the source). */
  sync(events: readonly InteractionVisualEvent[], unlockedAreas: readonly string[], onProgress: TransferProgressCallback): void;
  /** Advances every active burst by one rendered frame. `basketWorld` is the
   * player's live basket anchor (`PlayerActor.basketWorld`) — the same
   * layout-scale coordinate space `scaleStorePosition()` output and every
   * station position in this module already live in, so no extra transform
   * is needed to use it as a flight source/destination. */
  animate(deltaSeconds: number, basketWorld: THREE.Vector3): void;
}

function spawnBurst(event: InteractionVisualEvent, unlockedAreas: readonly string[]): ActiveBurst | null {
  if (event.kind === "harvest" && event.cropId && event.productId) return createHarvestBurst(event.sequence, event.cropId, event.productId, event.quantity ?? 1);
  if (event.kind === "stock" && event.productId) return createStockBurst(event.sequence, event.productId, event.quantity ?? 1, event.shelfStart ?? 0, unlockedAreas);
  if (event.kind === "return" && event.productId) return createReturnBurst(event.sequence, event.productId, event.quantity ?? 1);
  if (event.kind === "pay" && event.purchaseId) return createPayBurst(event.sequence, event.purchaseId, event.quantity ?? 1);
  return null;
}

export function buildTransferEffects(): TransferEffectsHandle {
  const group = new THREE.Group();
  group.name = "worldkit:transfer-effects";
  const active = new Map<number, ActiveBurst>();
  let unlockedAreas: readonly string[] = [];
  let onProgress: TransferProgressCallback = () => {};

  function sync(events: readonly InteractionVisualEvent[], nextUnlockedAreas: readonly string[], nextOnProgress: TransferProgressCallback) {
    unlockedAreas = nextUnlockedAreas;
    onProgress = nextOnProgress;

    const seen = new Set<number>();
    for (const event of events) {
      seen.add(event.sequence);
      if (active.has(event.sequence)) continue;
      const burst = spawnBurst(event, unlockedAreas);
      if (!burst) continue;
      active.set(event.sequence, burst);
      group.add(burst.group);
    }

    for (const [sequence, burst] of active) {
      if (seen.has(sequence)) continue;
      burst.dispose();
      active.delete(sequence);
    }
  }

  function animate(deltaSeconds: number, basketWorld: THREE.Vector3) {
    for (const burst of active.values()) burst.tick(deltaSeconds, basketWorld, onProgress);
  }

  return { group, sync, animate };
}
