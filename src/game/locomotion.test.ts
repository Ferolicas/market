import { describe, expect, it } from "vitest";
import { dampFactor, frameDelta, sampleVisitorJourney, travelProgress, turnTowards, VISITOR_ROUTES } from "./locomotion";
import { CHECKOUT_LANES } from "./stations/checkout-layout";
import { overlapsStoreObstacle, scaleStorePoint } from "./world-scale";

describe("locomotion helpers", () => {
  it("caps long frames so a stalled tab cannot teleport a character", () => {
    expect(frameDelta(0.4)).toBe(0.05);
    expect(frameDelta(1 / 60)).toBeCloseTo(1 / 60);
  });

  it("uses frame-rate independent damping", () => {
    expect(dampFactor(10, 1 / 60)).toBeCloseTo(1 - Math.exp(-10 / 60));
  });

  it("turns through the shortest arc without snapping", () => {
    const current = Math.PI - 0.1;
    const target = -Math.PI + 0.1;
    expect(turnTowards(current, target, 0.05)).toBeCloseTo(current + 0.05);
    expect(turnTowards(0, Math.PI / 2, 0.2)).toBeCloseTo(0.2);
  });

  it("keeps travel mostly linear with short acceleration ramps", () => {
    expect(travelProgress(0)).toBe(0);
    expect(travelProgress(0.5)).toBeCloseTo(0.5);
    expect(travelProgress(1)).toBe(1);
    const middleStep = travelProgress(0.6) - travelProgress(0.5);
    const nextStep = travelProgress(0.7) - travelProgress(0.6);
    expect(middleStep).toBeCloseTo(nextStep);
  });

  it("keeps the visitor route continuous through every phase", () => {
    const route = VISITOR_ROUTES[1];
    let previous = sampleVisitorJourney(0, -0.82, route).position;
    let largestStep = 0;
    for (let time = 1 / 60; time <= 47; time += 1 / 60) {
      const current = sampleVisitorJourney(time, -0.82, route).position;
      largestStep = Math.max(largestStep, Math.hypot(current[0] - previous[0], current[1] - previous[1]));
      previous = current;
    }
    expect(largestStep).toBeLessThan(0.08);
    expect(sampleVisitorJourney(29, -0.82, route).position).toEqual(route.queue);
    expect(sampleVisitorJourney(30.5, -0.82, route).position).toEqual(CHECKOUT_LANES[0].customerFront);
  });

  it("keeps every visitor clear of enlarged furniture for the full journey", () => {
    for (const [id, route] of Object.entries(VISITOR_ROUTES)) {
      const entryX = Number(id) % 2 ? -0.82 : 0.82;
      for (let time = 0; time <= 47; time += 1 / 30) {
        const point = scaleStorePoint(sampleVisitorJourney(time, entryX, route).position);
        expect(overlapsStoreObstacle(point, 0.55), `visitor ${id} intersects furniture at ${time.toFixed(2)}s`).toBe(false);
      }
    }
  });
});
