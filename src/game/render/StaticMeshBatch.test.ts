import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createStaticMeshBatch } from "./StaticMeshBatch";

describe("static mesh batching", () => {
  it("merges equivalent opaque meshes while preserving source names and transforms", () => {
    const root = new THREE.Group();
    const left = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#829278" }));
    left.name = "qa:left";
    left.position.x = -2;
    const right = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#829278" }));
    right.name = "qa:right";
    right.position.x = 2;
    root.add(left, right);

    const handle = createStaticMeshBatch(root);

    expect(handle.stats).toEqual({ sourceMeshes: 2, batches: 1, savedDraws: 1 });
    expect(root.getObjectByName("qa:left")).toBe(left);
    expect(root.getObjectByName("qa:right")).toBe(right);
    expect(left.visible).toBe(false);
    expect(right.visible).toBe(false);
    const batch = handle.group.children[0] as THREE.Mesh;
    batch.geometry.computeBoundingBox();
    expect(batch.geometry.boundingBox?.min.x).toBeCloseTo(-2.5);
    expect(batch.geometry.boundingBox?.max.x).toBeCloseTo(2.5);

    handle.dispose();
    expect(left.visible).toBe(true);
    expect(right.visible).toBe(true);
    expect(handle.group.parent).toBeNull();
  });

  it("leaves dynamic and named retail subtrees authoritative", () => {
    const root = new THREE.Group();
    const dynamic = new THREE.Group();
    dynamic.name = "dynamic:checkout";
    const product = new THREE.Group();
    product.name = "retail-product:tomatoes";
    const makeMesh = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: "#ffffff" }));
    const dynamicMeshes = [makeMesh(), makeMesh()];
    const productMeshes = [makeMesh(), makeMesh()];
    dynamic.add(...dynamicMeshes);
    product.add(...productMeshes);
    root.add(dynamic, product);

    const handle = createStaticMeshBatch(root);

    expect(handle.stats.savedDraws).toBe(0);
    expect([...dynamicMeshes, ...productMeshes].every((mesh) => mesh.visible)).toBe(true);
    handle.dispose();
  });
});
