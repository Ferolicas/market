import * as THREE from "three";
import { dampFactor } from "@/game/locomotion";
import { OVERVIEW_CAMERA_OFFSET } from "@/game/render/overview-camera";
import { CHECKOUT_CAMERA_FRAME, CHECKOUT_CAMERA_POSITION, CHECKOUT_CAMERA_TARGET } from "@/game/stations/checkout-layout";
import { CHILD_CHARACTER_SCENE_SCALE } from "@/game/animation/CharacterScale";
import { scaleStorePosition, WORLD_SCALE } from "@/game/world-scale";

const CAMERA_DISTANCE_FACTOR = 1.15;
const CAMERA_PROXIMITY_FACTOR = 1.3;
const TARGET_HEIGHT = 0.9 * CHILD_CHARACTER_SCENE_SCALE;
const checkoutTarget = new THREE.Vector3(...scaleStorePosition([...CHECKOUT_CAMERA_TARGET]));
const checkoutPosition = new THREE.Vector3(...scaleStorePosition([...CHECKOUT_CAMERA_POSITION]));

/**
 * The fixed-azimuth orthographic overview that follows the owner, blending
 * into the checkout composition while they operate a register. Same numbers
 * as the React scene's `OverviewCamera`; positions are in layout units and
 * the camera lives in world units.
 */
export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1 * WORLD_SCALE, 120 * WORLD_SCALE);
  private readonly lookAt = new THREE.Vector3();
  private readonly desiredLookAt = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private checkoutBlend = 0;
  private width = 1;
  private height = 1;

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.camera.left = -this.width / 2;
    this.camera.right = this.width / 2;
    this.camera.top = this.height / 2;
    this.camera.bottom = -this.height / 2;
    this.camera.updateProjectionMatrix();
  }

  /** `focusX`/`focusZ` in layout units (the owner's presented position). */
  update(focusX: number, focusZ: number, checkoutFocused: boolean, delta: number, snap = false) {
    this.desiredLookAt.set(focusX, TARGET_HEIGHT, focusZ);
    this.desiredPosition.set(focusX + OVERVIEW_CAMERA_OFFSET.x, TARGET_HEIGHT + OVERVIEW_CAMERA_OFFSET.y, focusZ + OVERVIEW_CAMERA_OFFSET.z);
    this.checkoutBlend = snap ? (checkoutFocused ? 1 : 0) : THREE.MathUtils.lerp(this.checkoutBlend, checkoutFocused ? 1 : 0, dampFactor(checkoutFocused ? 4.8 : 3.2, delta));
    this.desiredLookAt.lerp(checkoutTarget, this.checkoutBlend).multiplyScalar(WORLD_SCALE);
    this.desiredPosition.lerp(checkoutPosition, this.checkoutBlend).multiplyScalar(WORLD_SCALE);
    this.camera.position.copy(this.desiredPosition);
    this.lookAt.copy(this.desiredLookAt);
    this.camera.lookAt(this.lookAt);
    const overviewZoom = Math.min(this.width / 32, this.height / 28.5) / CAMERA_DISTANCE_FACTOR * CAMERA_PROXIMITY_FACTOR;
    const checkoutZoom = Math.min(this.width / CHECKOUT_CAMERA_FRAME.width, this.height / CHECKOUT_CAMERA_FRAME.height) * CAMERA_PROXIMITY_FACTOR;
    const zoom = THREE.MathUtils.lerp(overviewZoom, checkoutZoom, this.checkoutBlend);
    this.camera.zoom = snap ? zoom : THREE.MathUtils.lerp(this.camera.zoom, zoom, dampFactor(5, delta));
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Ground direction the camera looks along (for camera-relative input). */
  static readonly GROUND_FORWARD = { x: -OVERVIEW_CAMERA_OFFSET.x, y: -OVERVIEW_CAMERA_OFFSET.z } as const;
}
