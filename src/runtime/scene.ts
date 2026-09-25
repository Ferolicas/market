import * as THREE from "three";
import { loadGltf } from "@/client/WorldAssets";

export interface SceneStats {
  drawCalls: number;
  triangles: number;
}

const STORE_URL = "/models/market/budget/world/level30.glb";

/**
 * The measured runtime scene. Renderer settings match the empty baseline.
 * The only added content is the baked static store. Markers, characters,
 * stock and physics stay out.
 */
export class PlaceholderScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly ready: Promise<void>;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  private readonly lookAt = new THREE.Vector3();
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
    this.resize();
    this.ready = this.loadStore();
  }

  private async loadStore() {
    const gltf = await loadGltf(STORE_URL);
    if (this.disposed) return;
    const root = gltf.scene;
    root.matrixAutoUpdate = false;
    root.updateMatrix();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.matrixAutoUpdate = false;
      object.updateMatrix();
      object.frustumCulled = true;
      object.castShadow = false;
      object.receiveShadow = false;
      object.geometry.computeBoundingSphere();
    });
    this.scene.add(root);
    this.frameStore(root);
  }

  /** One fixed view of the whole bake. The camera does not move per frame. */
  private frameStore(root: THREE.Object3D) {
    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(this.lookAt);
    const radius = Math.max(1, bounds.getSize(new THREE.Vector3()).length() * 0.5);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const direction = new THREE.Vector3(16, 23, 25.75).normalize();
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = Math.max(0.1, distance - radius * 2);
    this.camera.far = distance + radius * 4;
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
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

  /** Draws the bake. The pose buffer stays in the loop so that path is unchanged. */
  render(pose: Float32Array) {
    void pose;
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
    this.renderer.dispose();
  }
}
