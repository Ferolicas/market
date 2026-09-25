import * as THREE from "three";
import { RUNTIME_CONTRACT } from "./contract";
import { POSE_STRIDE } from "./snapshot";

export interface SceneStats {
  drawCalls: number;
  triangles: number;
}

/**
 * Placeholder scene for the base runtime. Primitives only: the store's models,
 * textures and effects stay out until this loop has been measured on the phone.
 */
export class PlaceholderScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  private readonly player = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.9, 12),
    new THREE.MeshStandardMaterial({ color: "#ef6c4c", roughness: 0.45, metalness: 0.05 }),
  );
  private readonly crowd: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor("#d7ebe3", 1);
    this.renderer.shadowMap.enabled = false;

    this.scene.add(new THREE.HemisphereLight("#f4f7fb", "#8a7d6a", 1.15));
    const key = new THREE.DirectionalLight("#fff4e2", 1.8);
    key.position.set(6, 10, 4);
    this.scene.add(key);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(14, 48),
      new THREE.MeshStandardMaterial({ color: "#c5ddd2", roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const actorCount = RUNTIME_CONTRACT.placeholderActors;
    this.crowd = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.42, 0.72, 0.42),
      new THREE.MeshStandardMaterial({ color: "#2f6f5e", roughness: 0.62 }),
      actorCount - 1,
    );
    this.scene.add(this.crowd);
    this.player.position.y = 0.45;
    this.scene.add(this.player);
    this.camera.position.set(0, 11, 14);
    this.camera.lookAt(0, 0, 0);
    this.resize();
  }

  resize() {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** Applies one interpolated pose buffer. Actor 0 is the marker; the rest are instances. */
  render(pose: Float32Array) {
    this.player.position.x = pose[0];
    this.player.position.z = pose[1];
    this.player.rotation.y = pose[2];
    const instances = this.crowd.count;
    for (let index = 0; index < instances; index += 1) {
      const offset = (index + 1) * POSE_STRIDE;
      this.dummy.position.set(pose[offset], 0.36, pose[offset + 1]);
      this.dummy.rotation.set(0, pose[offset + 2], 0);
      this.dummy.updateMatrix();
      this.crowd.setMatrixAt(index, this.dummy.matrix);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    const stats = {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
    this.renderer.info.reset();
    return stats;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
