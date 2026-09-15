import { describe, expect, it } from "vitest";
import { advanceFedChicken, chickenFeedCapacity, collectChickenEggs, createFedChicken, feedChicken, upgradeFedChicken } from "./FedChicken";

describe("fed chicken production", () => {
  it("does not produce anything without feed", () => {
    expect(advanceFedChicken(createFedChicken(), 1_000_000).eggs).toBe(0);
  });
  it("consumes four tomatoes exactly once and produces four eggs in eight seconds", () => {
    const loaded = feedChicken(createFedChicken(), 4, 0);
    expect(loaded.consumed).toBe(4);
    expect(loaded.state.feed).toBe(3);
    expect(feedChicken(loaded.state, 4, 0).consumed).toBe(0);
    expect(advanceFedChicken(loaded.state, 1_999).eggs).toBe(0);
    expect(advanceFedChicken(loaded.state, 2_000).eggs).toBe(1);
    expect(advanceFedChicken(loaded.state, 8_000)).toMatchObject({ eggs: 4, feed: 0, nextEggAtMs: null });
  });
  it("supports the three-unit starting basket, without requiring an upgrade to feed", () => {
    const loaded = feedChicken(createFedChicken(), 3, 0);
    expect(loaded.consumed).toBe(3);
    expect(advanceFedChicken(loaded.state, 6_000).eggs).toBe(3);
  });
  it("collects an egg while the next is processing without cancelling production", () => {
    const loaded = feedChicken(createFedChicken(), 4, 0).state;
    const collected = collectChickenEggs(loaded, 3, 2_000);
    expect(collected.collected).toBe(1);
    expect(collected.state.nextEggAtMs).toBe(4_000);
    expect(advanceFedChicken(collected.state, 8_000).eggs).toBe(3);
  });
  it("restores a half-finished feed cycle exactly", () => {
    const loaded = feedChicken(createFedChicken(), 4, 0).state;
    const midway = advanceFedChicken(loaded, 3_000);
    const restored = JSON.parse(JSON.stringify(midway));
    expect(advanceFedChicken(restored, 8_000)).toEqual(advanceFedChicken(loaded, 8_000));
  });
  it("is independent of tick frequency and never duplicates at the same timestamp", () => {
    const loaded = feedChicken(createFedChicken(), 4, 0).state;
    let smallSteps = loaded;
    for (let now = 200; now <= 8_000; now += 200) smallSteps = advanceFedChicken(smallSteps, now);
    expect(smallSteps).toEqual(advanceFedChicken(loaded, 8_000));
    expect(advanceFedChicken(smallSteps, 8_000)).toEqual(smallSteps);
  });
  it("tier two processes one egg each second and tier three accepts six tomatoes", () => {
    const tier2 = upgradeFedChicken(createFedChicken(), 0);
    expect(chickenFeedCapacity(tier2.tier)).toBe(4);
    expect(advanceFedChicken(feedChicken(tier2, 4, 0).state, 4_000).eggs).toBe(4);
    const tier3 = upgradeFedChicken(tier2, 0);
    expect(chickenFeedCapacity(tier3.tier)).toBe(6);
    const loaded = feedChicken(tier3, 10, 0);
    expect(loaded.consumed).toBe(6);
    expect(advanceFedChicken(loaded.state, 6_000).eggs).toBe(6);
  });
  it("upgrades preserve the current cycle deadline", () => {
    const loaded = feedChicken(createFedChicken(), 4, 0).state;
    const upgraded = upgradeFedChicken(loaded, 1_000);
    expect(upgraded.nextEggAtMs).toBe(2_000);
    expect(advanceFedChicken(upgraded, 5_000).eggs).toBe(4);
  });
  it("stops with full output, preserves unused feed and resumes on collection", () => {
    const first = advanceFedChicken(feedChicken(createFedChicken(), 4, 0).state, 8_000);
    const full = advanceFedChicken(feedChicken(first, 4, 8_000).state, 16_000);
    const queued = feedChicken(full, 4, 16_000).state;
    expect(advanceFedChicken(queued, 100_000)).toMatchObject({ eggs: 8, feed: 4, nextEggAtMs: null });
    const collected = collectChickenEggs(queued, 3, 100_000);
    expect(collected.collected).toBe(3);
    expect(collected.state.nextEggAtMs).toBe(102_000);
    expect(advanceFedChicken(collected.state, 106_000)).toMatchObject({ eggs: 8, feed: 1, nextEggAtMs: null });
  });
  it.each([NaN, Infinity, -1, 0.5])("rejects invalid simulation timestamps (%s)", (time) => {
    const initial = createFedChicken();
    expect(feedChicken(initial, 4, time).consumed).toBe(0);
    expect(collectChickenEggs(initial, 3, time).collected).toBe(0);
    expect(upgradeFedChicken(initial, time)).toEqual(initial);
    expect(advanceFedChicken(initial, time)).toBe(initial);
  });
});
