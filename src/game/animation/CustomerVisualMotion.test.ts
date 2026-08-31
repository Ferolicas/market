import { describe, expect, it } from "vitest";
import { captureEmployeeMotion, projectCustomerMotion, type CustomerMotionSnapshot } from "./CustomerVisualMotion";
import type { EmployeeRuntimeState } from "../types";

const moving: CustomerMotionSnapshot = {
  x: 1,
  z: 2,
  targetX: 5,
  targetZ: 2,
  path: [[5, 2]],
  speed: 2,
  moving: true,
  capturedAtMs: 1_000,
};

describe("customer visual motion", () => {
  it("fills the 100 ms simulation gap with continuous forward motion", () => {
    expect(projectCustomerMotion(moving, 1_050)).toMatchObject({ x: 1.1, z: 2, headingX: 1, headingZ: 0 });
    expect(projectCustomerMotion(moving, 1_100)).toMatchObject({ x: 1.2, z: 2, headingX: 1, headingZ: 0 });
  });

  it("never projects through a waypoint or beyond the safe snapshot horizon", () => {
    expect(projectCustomerMotion({ ...moving, targetX: 1.2, path: [[1.2, 2]] }, 1_250).x).toBeCloseTo(1.2);
    expect(projectCustomerMotion(moving, 5_000).x).toBeCloseTo(1.6);
  });

  it("uses the whole NavMesh polyline instead of pausing at short waypoints", () => {
    const projected = projectCustomerMotion({ ...moving, x: 0, z: 0, targetX: 0.04, targetZ: 0, path: [[0.04, 0], [0.08, 0], [1, 0]] }, 1_100);
    expect(projected.x).toBeCloseTo(0.2);
    expect(projected.headingX).toBe(1);
  });

  it("holds an authoritative stationary pose", () => {
    expect(projectCustomerMotion({ ...moving, moving: false }, 1_250)).toEqual({ x: 1, z: 2, headingX: 0, headingZ: 0 });
  });

  it("projects a moving employee while preserving the configured level speed", () => {
    const employee: EmployeeRuntimeState = {
      state: "NAVIGATE_PICKUP", assignedProduct: "tomatoes", assignedStationId: "stockroom",
      carry: { capacity: 4, item: null }, x: 0, z: 0, targetX: 2, targetZ: 0,
      path: [[2, 0]], pathIndex: 0, speed: 1.82, currentSpeed: 1.82, stateSince: 0,
    };
    const snapshot = captureEmployeeMotion(employee, 1_000);

    expect(snapshot.speed).toBe(1.82);
    expect(projectCustomerMotion(snapshot, 1_100).x).toBeCloseTo(0.182);
  });
});
