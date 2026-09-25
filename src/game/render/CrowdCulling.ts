import * as THREE from "three";

/**
 * Per-character visibility for the instanced crowd. One InstancedMesh spans
 * the whole store, so three cannot cull it; the frame loop asks here, per
 * character, before spending a pose and its sockets. Positions come in the
 * crowd group's own space (the scene scales that group by `WORLD_SCALE`) and
 * are taken to world space, where the camera frustum lives.
 */
const frustum = new THREE.Frustum();
const frustumMatrix = new THREE.Matrix4();
const sphere = new THREE.Sphere();
export const CROWD_VISIBILITY_RADIUS = 2.6;
export const CROWD_VISIBILITY_HEIGHT = 1.1;

export function updateCrowdFrustum(camera: THREE.Camera) {
  frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(frustumMatrix);
}

export function crowdCharacterInView(parent: THREE.Object3D | null, x: number, z: number) {
  sphere.center.set(x, CROWD_VISIBILITY_HEIGHT, z);
  sphere.radius = CROWD_VISIBILITY_RADIUS;
  if (parent) {
    sphere.center.applyMatrix4(parent.matrixWorld);
    sphere.radius *= parent.matrixWorld.getMaxScaleOnAxis();
  }
  return frustum.intersectsSphere(sphere);
}
