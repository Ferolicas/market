import { describe, expect, it } from "vitest";
import { evaluateBaseGate, percentile, RUNTIME_CONTRACT, summarizeFrames } from "./contract";

describe("runtime contract", () => {
  it("splits the crowd actor count into exactly the level-30 customers and staff", () => {
    expect(RUNTIME_CONTRACT.crowdCustomerActors + RUNTIME_CONTRACT.crowdEmployeeActors).toBe(RUNTIME_CONTRACT.placeholderActors);
  });

  it("reads the 99th percentile from the ordered sample", () => {
    const samples = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(samples, 99)).toBe(99);
    expect(percentile(samples, 95)).toBe(95);
    expect(percentile([], 99)).toBe(0);
  });

  const steady = (workMs: number, gapMs = 16.7) => ({ workMs, gapMs });

  it("passes cheap work on a 60 Hz panel and fails a long callback", () => {
    const healthy = summarizeFrames(Array.from({ length: 120 }, () => steady(1.2)), { drawCalls: 3, triangles: 200, loadMs: 40 });
    expect(healthy.p99Ms).toBeCloseTo(1.2);
    expect(healthy.gapAverageMs).toBeCloseTo(16.7);
    expect(evaluateBaseGate(healthy).pass).toBe(true);

    const slow = summarizeFrames(Array.from({ length: 120 }, () => steady(17, 17)), { drawCalls: 3, triangles: 200, loadMs: 40 });
    const gate = evaluateBaseGate(slow);
    expect(gate.pass).toBe(false);
    expect(gate.failures.some((failure) => failure.includes("trabajaron"))).toBe(true);
  });

  it("fails p99 above 12 ms even when the average looks fine", () => {
    const samples = [...Array.from({ length: 98 }, () => steady(2)), steady(13), steady(14)];
    const summary = summarizeFrames(samples, { drawCalls: 3, triangles: 200, loadMs: 40 });
    expect(summary.p99Ms).toBeGreaterThan(RUNTIME_CONTRACT.maxFrameP99Ms);
    expect(evaluateBaseGate(summary).pass).toBe(false);
  });

  it("fails a skipped refresh and ignores the final load target in this phase", () => {
    const hitch = summarizeFrames(
      [...Array.from({ length: 80 }, () => steady(2)), steady(2, 40)],
      { drawCalls: 3, triangles: 200, loadMs: 9_000 },
    );
    expect(evaluateBaseGate(hitch).pass).toBe(false);
    expect(hitch.gapsOver25Ms).toBe(1);
    const loaded = summarizeFrames(Array.from({ length: 60 }, () => steady(2)), { drawCalls: 3, triangles: 200, loadMs: 9_000 });
    expect(evaluateBaseGate(loaded).pass).toBe(true);
  });

  it("tolerates the iPhone's own occasional Safari gaps on a long sample, but not on a short one", () => {
    // Same ratio as the empty-runtime baseline (16 gaps / 25 600 renders):
    // a long field session sees a few gaps and should still pass.
    const longSession = summarizeFrames(
      [...Array.from({ length: 26_691 - 4 }, () => steady(2)), ...Array.from({ length: 4 }, () => steady(2, 40))],
      { drawCalls: 115, triangles: 134_456, loadMs: 407 },
    );
    expect(longSession.gapsOver25Ms).toBe(4);
    expect(evaluateBaseGate(longSession).pass).toBe(true);

    // The same 4 hitches over a short sample are not "occasional Safari
    // noise" anymore relative to the sample size, so they still fail.
    const shortSession = summarizeFrames(
      [...Array.from({ length: 76 }, () => steady(2)), ...Array.from({ length: 4 }, () => steady(2, 40))],
      { drawCalls: 115, triangles: 134_456, loadMs: 407 },
    );
    expect(evaluateBaseGate(shortSession).pass).toBe(false);
  });
});
