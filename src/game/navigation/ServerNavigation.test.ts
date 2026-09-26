import { afterEach, describe, expect, it, vi } from "vitest";
import { createCampaignGame } from "../engine";
import type { GameState } from "../types";
import { NavMeshService } from "./NavMeshService";
import { serverPathfinderFor } from "./ServerNavigation";

function stateWithAreas(areas: readonly string[]): GameState {
  const state = createCampaignGame("ES");
  state.franchises[0].unlockedAreas = [...areas];
  return state;
}

describe("serverPathfinderFor: cache keyed by walkableSignature, not raw area names", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the cached mesh when two area sets leave every obstacle's availability unchanged", async () => {
    const rebuildSpy = vi.spyOn(NavMeshService.prototype, "rebuild");
    // Neither set includes "purchase-campaign", so `fixtureAvailable` reports
    // every gated fixture as available either way — same walkableSignature,
    // different raw area lists (order and an unrelated stat-only area added).
    await serverPathfinderFor(stateWithAreas(["store-floor", "farm-tomato", "checkout-1"]));
    const callsAfterFirst = rebuildSpy.mock.calls.length;
    await serverPathfinderFor(stateWithAreas(["checkout-1", "farm-tomato", "store-floor", "farm-tomato-2"]));
    expect(rebuildSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("builds a distinct mesh when a real obstacle's availability actually changes", async () => {
    const rebuildSpy = vi.spyOn(NavMeshService.prototype, "rebuild");
    await serverPathfinderFor(stateWithAreas(["purchase-campaign"]));
    const callsAfterFirst = rebuildSpy.mock.calls.length;
    await serverPathfinderFor(stateWithAreas(["purchase-campaign", "expansion-side"]));
    expect(rebuildSpy.mock.calls.length).toBe(callsAfterFirst + 1);
  });

  it("still returns a working pathfinder after a cache hit", async () => {
    await serverPathfinderFor(stateWithAreas(["store-floor", "farm-tomato", "checkout-1"]));
    const pathfinder = await serverPathfinderFor(stateWithAreas(["checkout-1", "store-floor", "farm-tomato"]));
    expect(pathfinder).toBeDefined();
    expect(pathfinder?.([0, 0], [0, 0])).toBeDefined();
  });
});
