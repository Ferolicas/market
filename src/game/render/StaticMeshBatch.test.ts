import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createStaticMeshBatch } from "./StaticMeshBatch";

function standardBox(color: string, options: { roughness?: number; emissive?: string } = {}) {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color, roughness: options.roughness ?? 1, emissive: options.emissive ?? "#000000" }));
}

function placedInstances(count: number, color: string) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color, roughness: 1 }), count);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < count; index += 1) {
    dummy.position.set(index * 3, 5, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function vertexColorAt(geometry: THREE.BufferGeometry, vertex: number) {
  const colors = geometry.getAttribute("color");
  return [colors.getX(vertex), colors.getY(vertex), colors.getZ(vertex)];
}

describe("static mesh batching", () => {
  it("merges equivalent opaque meshes while preserving source names and transforms", () => {
    const root = new THREE.Group();
    const left = standardBox("#829278");
    left.name = "qa:left";
    left.position.x = -2;
    const right = standardBox("#829278");
    right.name = "qa:right";
    right.position.x = 2;
    root.add(left, right);

    const handle = createStaticMeshBatch(root);

    expect(handle.stats).toEqual({ sourceMeshes: 2, batches: 1, savedDraws: 1 });
    expect(root.getObjectByName("qa:left")).toBe(left);
    expect(root.getObjectByName("qa:right")).toBe(right);
    expect(left.visible).toBe(false);
    expect(right.visible).toBe(false);
    // Hidden sources stop recomposing matrices, yet lookups still resolve
    // their authored world transform.
    expect(left.matrixAutoUpdate).toBe(false);
    expect(right.matrixAutoUpdate).toBe(false);
    root.updateMatrixWorld(true);
    expect(right.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(2);
    const batch = handle.group.children[0] as THREE.Mesh;
    batch.geometry.computeBoundingBox();
    expect(batch.geometry.boundingBox?.min.x).toBeCloseTo(-2.5);
    expect(batch.geometry.boundingBox?.max.x).toBeCloseTo(2.5);

    handle.dispose();
    expect(left.visible).toBe(true);
    expect(right.visible).toBe(true);
    expect(left.matrixAutoUpdate).toBe(true);
    expect(right.matrixAutoUpdate).toBe(true);
    expect(handle.group.parent).toBeNull();
  });

  it("merges different colours into one draw by baking each colour per vertex", () => {
    const root = new THREE.Group();
    const cream = standardBox("#eee8dc");
    cream.position.x = -2;
    const green = standardBox("#344c3e");
    green.position.x = 2;
    root.add(cream, green);

    const handle = createStaticMeshBatch(root);

    expect(handle.stats).toEqual({ sourceMeshes: 2, batches: 1, savedDraws: 1 });
    const batch = handle.group.children[0] as THREE.Mesh;
    const material = batch.material as THREE.MeshStandardMaterial;
    expect(material.vertexColors).toBe(true);
    expect([material.color.r, material.color.g, material.color.b]).toEqual([1, 1, 1]);
    expect(material).not.toBe(cream.material);
    const creamLinear = (cream.material as THREE.MeshStandardMaterial).color;
    const greenLinear = (green.material as THREE.MeshStandardMaterial).color;
    const vertexCount = cream.geometry.getAttribute("position").count;
    // diffuse × vertexColor reproduces material.color (linear values, Float32).
    const expectClose = (actual: number[], expected: THREE.Color) => {
      expect(actual[0]).toBeCloseTo(expected.r, 6);
      expect(actual[1]).toBeCloseTo(expected.g, 6);
      expect(actual[2]).toBeCloseTo(expected.b, 6);
    };
    expectClose(vertexColorAt(batch.geometry, 0), creamLinear);
    expectClose(vertexColorAt(batch.geometry, vertexCount), greenLinear);
    handle.dispose();
  });

  it("keeps shading parameters other than colour as separate batches", () => {
    const root = new THREE.Group();
    root.add(standardBox("#829278", { roughness: 0.5 }), standardBox("#829278", { roughness: 0.5 }), standardBox("#829278", { emissive: "#ff0000" }), standardBox("#829278", { emissive: "#ff0000" }));

    const handle = createStaticMeshBatch(root);

    expect(handle.stats).toEqual({ sourceMeshes: 4, batches: 2, savedDraws: 2 });
    handle.dispose();
  });

  it("bakes placed static instanced meshes into the merged batch", () => {
    const root = new THREE.Group();
    const instances = placedInstances(3, "#a46f3d");
    instances.name = "qa:uprights";
    const single = standardBox("#a46f3d");
    single.position.set(-4, 0, 0);
    root.add(instances, single);

    const handle = createStaticMeshBatch(root);

    expect(handle.stats).toEqual({ sourceMeshes: 2, batches: 1, savedDraws: 1 });
    expect(instances.visible).toBe(false);
    expect(instances.matrixAutoUpdate).toBe(false);
    const batch = handle.group.children[0] as THREE.Mesh;
    const boxVertices = single.geometry.getAttribute("position").count;
    expect(batch.geometry.getAttribute("position").count).toBe(boxVertices * 4);
    batch.geometry.computeBoundingBox();
    expect(batch.geometry.boundingBox?.min.x).toBeCloseTo(-4.5);
    expect(batch.geometry.boundingBox?.max.x).toBeCloseTo(6.5);
    expect(batch.geometry.boundingBox?.max.y).toBeCloseTo(5.5);

    handle.dispose();
    expect(instances.visible).toBe(true);
    expect(instances.matrixAutoUpdate).toBe(true);
  });

  it("leaves instanced meshes with per-instance colours, mirrored instances or unplaced matrices alone", () => {
    const root = new THREE.Group();
    const coloured = placedInstances(2, "#a46f3d");
    coloured.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(6), 3);
    const mirrored = placedInstances(2, "#a46f3d");
    const flip = new THREE.Matrix4().makeScale(-1, 1, 1);
    mirrored.setMatrixAt(1, flip);
    mirrored.instanceMatrix.needsUpdate = true;
    const unplaced = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#a46f3d", roughness: 1 }), 2);
    root.add(coloured, mirrored, unplaced, standardBox("#a46f3d"));

    const handle = createStaticMeshBatch(root);

    expect(handle.stats.savedDraws).toBe(0);
    expect([coloured, mirrored, unplaced].every((mesh) => mesh.visible)).toBe(true);
    handle.dispose();
  });

  it("leaves dynamic and authoritative stock subtrees authoritative", () => {
    const root = new THREE.Group();
    const dynamic = new THREE.Group();
    dynamic.name = "dynamic:checkout";
    const stock = new THREE.Group();
    stock.name = "retail-stock:tomatoes";
    const makeMesh = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: "#ffffff" }));
    const dynamicMeshes = [makeMesh(), makeMesh()];
    const stockMeshes = [makeMesh(), makeMesh()];
    dynamic.add(...dynamicMeshes);
    stock.add(...stockMeshes);
    root.add(dynamic, stock);

    const handle = createStaticMeshBatch(root);

    expect(handle.stats.savedDraws).toBe(0);
    expect([...dynamicMeshes, ...stockMeshes].every((mesh) => mesh.visible)).toBe(true);
    handle.dispose();
  });

  it("merges static decorative retail props while keeping their names addressable", () => {
    const root = new THREE.Group();
    const bread = new THREE.Group();
    bread.name = "retail-product:bread";
    const loaves = [standardBox("#b97336"), standardBox("#b97336")];
    bread.add(...loaves);
    root.add(bread);

    const handle = createStaticMeshBatch(root);

    expect(handle.stats.savedDraws).toBe(1);
    expect(root.getObjectByName("retail-product:bread")).toBe(bread);
    expect(loaves.every((mesh) => !mesh.visible)).toBe(true);
    handle.dispose();
  });
});
