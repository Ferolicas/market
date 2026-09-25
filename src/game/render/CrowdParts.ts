import * as THREE from "three";

/**
 * A prop drawn many times per frame — a cart, a basket, a tomato — is a list
 * of parts, each a geometry and material at a local transform. One
 * InstancedMesh per part draws every copy in the scene in one call.
 */
export interface InstancedPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  local: THREE.Matrix4;
  /** Wheels roll: the part's local matrix is rebuilt per push from this. */
  dynamic?: boolean;
}

const scratchMatrix = new THREE.Matrix4();

export class PartsInstancer {
  readonly meshes: THREE.InstancedMesh[];
  count = 0;
  readonly capacity: number;

  constructor(readonly parts: readonly InstancedPart[], capacity: number, name: string) {
    this.capacity = capacity;
    this.meshes = parts.map((part, index) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
      mesh.name = `${name}:${index}`;
      mesh.count = 0;
      // Instances spread over the whole store; culling per part would cost
      // more than drawing them.
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    });
  }

  begin() {
    this.count = 0;
  }

  /** Places one copy of the prop at `matrix`; returns the instance index or -1 when full. */
  push(matrix: THREE.Matrix4) {
    if (this.count >= this.capacity) return -1;
    const index = this.count;
    for (let part = 0; part < this.parts.length; part += 1) {
      scratchMatrix.multiplyMatrices(matrix, this.parts[part].local);
      this.meshes[part].setMatrixAt(index, scratchMatrix);
    }
    this.count += 1;
    return index;
  }

  /** Places one part of the prop with its own local matrix (a rolling wheel). */
  pushPart(part: number, matrix: THREE.Matrix4, local: THREE.Matrix4) {
    if (this.count >= this.capacity) return;
    scratchMatrix.multiplyMatrices(matrix, local);
    this.meshes[part].setMatrixAt(this.count, scratchMatrix);
  }

  end() {
    for (const mesh of this.meshes) {
      mesh.count = this.count;
      // An empty InstancedMesh still binds its program and uniforms every
      // frame before three skips the draw; hide it instead.
      mesh.visible = this.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  attach(parent: THREE.Object3D) {
    for (const mesh of this.meshes) parent.add(mesh);
  }

  detach() {
    for (const mesh of this.meshes) mesh.removeFromParent();
  }

  dispose() {
    for (const mesh of this.meshes) mesh.dispose();
  }
}

export function localMatrix(position: readonly [number, number, number] = [0, 0, 0], rotation: readonly [number, number, number] = [0, 0, 0], scale: number | readonly [number, number, number] = 1) {
  const s = typeof scale === "number" ? [scale, scale, scale] as const : scale;
  return new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...s));
}

/** Parts of a nested prop: `outer × inner` for every inner part. */
export function nestParts(outer: THREE.Matrix4, parts: readonly InstancedPart[]): InstancedPart[] {
  return parts.map((part) => ({ ...part, local: new THREE.Matrix4().multiplyMatrices(outer, part.local) }));
}

/** A mutable registry the frame loop fills and effects register into; a
 * class so React's compiler rules do not mistake it for render state. */
export class InstanceRegistry<T> {
  private readonly entries = new Map<string, T>();
  set(key: string, value: T) { this.entries.set(key, value); }
  get(key: string) { return this.entries.get(key); }
  delete(key: string) { this.entries.delete(key); }
  clear() { this.entries.clear(); }
  values() { return this.entries.values(); }
}
