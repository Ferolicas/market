import { describe, expect, it } from "vitest";
import { overlapsStoreObstacle, scaleStorePoint, STORE_LAYOUT_SCALE } from "../world-scale";
import { RETAIL_DEPARTMENTS } from "./retail-layout";

const NAVMESH_FURNITURE_PADDING = 0.31 * STORE_LAYOUT_SCALE;

describe("retail service points", () => {
  it("keeps every stocking sensor on a walkable NavMesh lane", () => {
    Object.values(RETAIL_DEPARTMENTS).forEach((department) => {
      const servicePoint = scaleStorePoint([...department.service]);
      expect(
        overlapsStoreObstacle(servicePoint, NAVMESH_FURNITURE_PADDING),
        `${department.id} service point is excluded from the NavMesh`,
      ).toBe(false);
    });
  });
});
