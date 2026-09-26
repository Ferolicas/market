import * as pc from "playcanvas";
import { OVERVIEW_CAMERA_OFFSET } from "@/game/render/overview-camera";
import { WORLD_SCALE, STORE_LAYOUT_SCALE, scaleStorePosition } from "@/game/world-scale";
import { STOREFRONT_LAYOUT, STORE_REAR_DOOR, rearDoorWallSegments, rearDoorWallPanels } from "@/game/stations/storefront-layout";

/**
 * Phase 1 of the PlayCanvas port: engine bootstrap + the structural shell
 * (ground, building walls/frames, city perimeter block-out) only. No
 * furniture, farm, checkout, doors-that-open, crowd or player yet — see
 * `docs/RUNTIME-PARITY-INVENTORY.md` and the Phase 2 list in the report for
 * what comes next. This class owns a single `pc.Application` render loop
 * (`app.on("update", ...)`, `app.start()`); nothing else should drive frames.
 *
 * Every dimension/color below is copied from the real source of truth
 * (`src/components/game/MarketScene.tsx`'s `MarketGround`/`MarketBuilding`,
 * `src/components/game/CityPerimeter.tsx`, `src/game/stations/storefront-layout.ts`,
 * `src/game/render/overview-camera.ts`, `src/game/world-scale.ts`,
 * `src/game/time/BusinessDay.ts`'s `DAY` preset) — never approximated.
 */

// Mirrors src/game/animation/CharacterScale.ts (CHILD_CHARACTER_SCENE_SCALE).
// Only used to reproduce the overview camera's initial look-at height.
const CHILD_CHARACTER_SCENE_SCALE = 1.65;

// Mirrors the constants next to OverviewCamera in MarketScene.tsx.
const CAMERA_DISTANCE_FACTOR = 1.15;
const CAMERA_PROXIMITY_FACTOR = 1.3;
const CAMERA_FRAME_WIDTH = 32;
const CAMERA_FRAME_HEIGHT = 28.5;

// Mirrors MarketScene.tsx's PLAYER_START = scaleStorePosition([0, 0, 6.25]).
const PLAYER_START = scaleStorePosition([0, 0, 6.25]);

// Mirrors the DAY preset in src/game/time/BusinessDay.ts. Phase 1 renders a
// fixed daytime look; the day/night cycle is a later phase.
const DAYLIGHT_DAY = { background: "#b8dfce", ambientIntensity: 1.15, keyIntensity: 2.3, keyColor: "#fff6df" };

function hexToColor(hex: string): pc.Color {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return new pc.Color(r, g, b);
}

interface BoxSpec {
  size: [number, number, number];
  pos: [number, number, number];
  color: string;
  opacity?: number;
  name?: string;
}

export class PlayCanvasRuntime {
  readonly app: pc.Application;
  private readonly canvas: HTMLCanvasElement;
  private readonly cameraEntity: pc.Entity;
  private readonly materials = new Map<string, pc.StandardMaterial>();
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.app = new pc.Application(canvas, {
      graphicsDeviceOptions: { antialias: true },
    });
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);

    this.app.scene.ambientLight = new pc.Color(
      Math.min(1, DAYLIGHT_DAY.ambientIntensity),
      Math.min(1, DAYLIGHT_DAY.ambientIntensity),
      Math.min(1, DAYLIGHT_DAY.ambientIntensity),
    );

    const keyLight = new pc.Entity("key-light");
    keyLight.addComponent("light", {
      type: "directional",
      color: hexToColor(DAYLIGHT_DAY.keyColor),
      intensity: DAYLIGHT_DAY.keyIntensity,
      castShadows: false,
    });
    // Real position from MarketKeyLight: [8, 13, 7] * WORLD_SCALE, targeting
    // the origin (three's DirectionalLight default target).
    keyLight.setPosition(8 * WORLD_SCALE, 13 * WORLD_SCALE, 7 * WORLD_SCALE);
    keyLight.lookAt(0, 0, 0);
    this.app.root.addChild(keyLight);

    this.cameraEntity = new pc.Entity("overview-camera");
    this.cameraEntity.addComponent("camera", {
      projection: pc.PROJECTION_ORTHOGRAPHIC,
      nearClip: 0.1 * WORLD_SCALE,
      farClip: 120 * WORLD_SCALE,
      clearColor: hexToColor(DAYLIGHT_DAY.background),
    });
    this.app.root.addChild(this.cameraEntity);
    this.positionCamera();

    const worldRoot = new pc.Entity("world-scale-root");
    worldRoot.setLocalScale(WORLD_SCALE, WORLD_SCALE, WORLD_SCALE);
    this.app.root.addChild(worldRoot);

    const groundGroup = new pc.Entity("perf:ground");
    groundGroup.setLocalScale(STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE);
    worldRoot.addChild(groundGroup);
    this.buildGround(groundGroup);

    const cityGroup = new pc.Entity("perf:city");
    cityGroup.setLocalScale(STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE);
    worldRoot.addChild(cityGroup);
    this.buildCityPerimeter(cityGroup);

    const buildingGroup = new pc.Entity("perf:building");
    buildingGroup.setLocalScale(STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE);
    worldRoot.addChild(buildingGroup);
    this.buildBuilding(buildingGroup);

    this.app.on("update", () => this.onUpdate());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  /** Single render loop tick. Nothing else drives frames for this runtime. */
  private onUpdate() {
    // Phase 1: static shell, nothing to animate per frame yet.
  }

  start() {
    this.app.start();
  }

  resize() {
    const width = this.canvas.clientWidth || this.canvas.width || 1;
    const height = this.canvas.clientHeight || this.canvas.height || 1;
    this.app.resizeCanvas(width, height);
    this.updateOrthoHeight(width, height);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.app.destroy();
  }

  private positionCamera() {
    // Exact port of OverviewCamera's initial <OrthographicCamera> position in
    // MarketScene.tsx: (PLAYER_START + OVERVIEW_CAMERA_OFFSET) * WORLD_SCALE,
    // with a fixed 23.9 initial height (before the per-frame follow kicks in
    // — the player/follow behaviour itself is a later phase).
    const x = (PLAYER_START[0] + OVERVIEW_CAMERA_OFFSET.x) * WORLD_SCALE;
    const y = 23.9 * WORLD_SCALE;
    const z = (PLAYER_START[2] + OVERVIEW_CAMERA_OFFSET.z) * WORLD_SCALE;
    this.cameraEntity.setPosition(x, y, z);
    const targetY = 0.9 * CHILD_CHARACTER_SCENE_SCALE * WORLD_SCALE;
    const targetX = PLAYER_START[0] * WORLD_SCALE;
    const targetZ = PLAYER_START[2] * WORLD_SCALE;
    this.cameraEntity.lookAt(targetX, targetY, targetZ);
  }

  /**
   * Direct algebraic port of OverviewCamera's zoom formula:
   *   zoom = min(w/32, h/28.5) / CAMERA_DISTANCE_FACTOR * CAMERA_PROXIMITY_FACTOR
   *   visibleHeight = canvasHeightPx / zoom   (three's ortho zoom convention:
   *     1 CSS pixel == 1 world unit at zoom=1, drei's default frustum)
   * PlayCanvas's orthoHeight is half that visible height. Aspect ratio mode
   * is left at its default (AUTO), which reproduces the same contain-fit
   * behaviour as the three.js version for typical landscape viewports.
   */
  private updateOrthoHeight(width: number, height: number) {
    const zoom = (Math.min(width / CAMERA_FRAME_WIDTH, height / CAMERA_FRAME_HEIGHT) / CAMERA_DISTANCE_FACTOR) * CAMERA_PROXIMITY_FACTOR;
    const visibleHeight = height / Math.max(zoom, 1e-6);
    const camera = this.cameraEntity.camera;
    if (camera) camera.orthoHeight = visibleHeight / 2;
  }

  private material(color: string, opacity = 1): pc.StandardMaterial {
    const key = `${color}|${opacity}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const material = new pc.StandardMaterial();
    material.diffuse = hexToColor(color);
    if (opacity < 1) {
      material.opacity = opacity;
      material.blendType = pc.BLEND_NORMAL;
      material.depthWrite = false;
    }
    material.update();
    this.materials.set(key, material);
    return material;
  }

  private box(parent: pc.Entity, spec: BoxSpec) {
    const entity = new pc.Entity(spec.name ?? "box");
    entity.addComponent("render", { type: "box", material: this.material(spec.color, spec.opacity ?? 1) });
    entity.setLocalScale(spec.size[0], spec.size[1], spec.size[2]);
    entity.setLocalPosition(spec.pos[0], spec.pos[1], spec.pos[2]);
    parent.addChild(entity);
    return entity;
  }

  // ---- MarketGround (src/components/game/MarketScene.tsx, lines ~1896-1909) ----
  private buildGround(parent: pc.Entity) {
    this.box(parent, { size: [23, 0.16, 17], pos: [0, -0.08, -0.35], color: "#eee8dc", name: "floor" });
    for (const x of [-7.6, -3.8, 0, 3.8, 7.6]) {
      this.box(parent, { size: [0.018, 0.008, 16.7], pos: [x, 0.012, -0.35], color: "#d9d2c5", name: "floor-seam-x" });
    }
    for (const z of [-6.8, -3.4, 0, 3.4, 6.8]) {
      this.box(parent, { size: [22.7, 0.008, 0.018], pos: [0, 0.013, z - 0.35], color: "#d9d2c5", name: "floor-seam-z" });
    }
    this.box(parent, { size: [23, 0.14, 7.5], pos: [0, -0.1, 11.9], color: "#d7e3db", name: "front-apron" });
    this.box(parent, { size: [25, 0.12, 1.2], pos: [0, -0.09, 16.15], color: "#566a62", name: "sidewalk-strip" });
    for (const x of [-6, 0, 6]) {
      this.box(parent, { size: [2.7, 0.02, 0.1], pos: [x, -0.015, 16.1], color: "#f4d58d", name: "sidewalk-mark" });
    }
    this.box(parent, { size: [2.58, 0.08, 2.2], pos: [STORE_REAR_DOOR.x, -0.015, -9.61], color: "#b8ab8f", name: "rear-door-mat" });
    for (const offset of [-0.72, 0, 0.72]) {
      this.box(parent, { size: [0.035, 0.018, 2.08], pos: [STORE_REAR_DOOR.x + offset, 0.03, -9.61], color: "#dfd3b8", name: "rear-path-inlay" });
    }
  }

  // ---- MarketBuilding (src/components/game/MarketScene.tsx, lines ~1911-1966) ----
  // Static shell only: door leaves are rendered CLOSED (progress = 0); the
  // motorised open/close animation and the "MINI MARKET"/"GRANJA" text signs
  // (need a loaded font asset) are deferred to a later phase.
  private buildBuilding(parent: pc.Entity) {
    const wallHeight = STOREFRONT_LAYOUT.wallHeight;

    for (const segment of rearDoorWallSegments()) {
      this.box(parent, { size: [segment.width, wallHeight, STORE_REAR_DOOR.wallDepth], pos: [segment.centerX, wallHeight / 2, STORE_REAR_DOOR.wallCenterZ], color: "#eee8dc", name: "rear-wall-segment" });
      this.box(parent, { size: [Math.max(0.01, segment.width - 0.08), 1.25, 0.12], pos: [segment.centerX, 0.68, -8.34], color: "#2f6958", name: "rear-wall-accent" });
    }
    for (const panel of rearDoorWallPanels()) {
      this.box(parent, { size: [panel.width, wallHeight * 0.57, 0.08], pos: [panel.centerX, wallHeight * 0.54, -8.35], color: "#f7f2e8", name: "rear-wall-panel" });
    }
    this.box(parent, { size: [5.6, 0.78, 0.18], pos: [0, wallHeight - 0.82, -8.28], color: "#173f35", name: "rear-sign-backing" });

    // Rear farm door frame (STORE_REAR_DOOR).
    const rearDoor = STORE_REAR_DOOR.door;
    const rx = STORE_REAR_DOOR.x;
    const rz = STORE_REAR_DOOR.z;
    for (const side of [-1, 1] as const) {
      this.box(parent, { size: [rearDoor.postWidth, rearDoor.leafHeight + 0.18, rearDoor.frameDepth], pos: [rx + side * rearDoor.outerPostOffset, (rearDoor.leafHeight + 0.18) / 2, rz + 0.02], color: "#294a41", name: "rear-frame-post" });
    }
    this.box(parent, { size: [rearDoor.outerPostOffset * 2 + rearDoor.postWidth, 0.18, rearDoor.frameDepth], pos: [rx, rearDoor.leafHeight + 0.09, rz + 0.02], color: "#294a41", name: "rear-frame-top" });
    this.box(parent, { size: [2.18, 0.5, 0.16], pos: [rx, rearDoor.leafHeight + 0.48, rz + 0.035], color: "#173f35", name: "rear-frame-sign" });
    this.box(parent, { size: [rearDoor.outerPostOffset * 2, 0.07, 0.54], pos: [rx, 0.035, rz], color: "#8e9894", name: "rear-frame-threshold" });

    this.box(parent, { size: [0.34, wallHeight, 16.5], pos: [-11.35, wallHeight / 2, -0.35], color: "#e5ded2", name: "side-wall-left" });
    this.box(parent, { size: [0.34, wallHeight, 16.5], pos: [11.35, wallHeight / 2, -0.35], color: "#e5ded2", name: "side-wall-right" });

    const frontGlassHeight = wallHeight - 0.6;
    const frontGlassCenterY = frontGlassHeight / 2 + 0.3;
    for (const x of [-6.585, 6.585]) {
      this.box(parent, { size: [9.53, 0.6, 0.3], pos: [x, 0.3, 7.78], color: "#e7dfd2", name: "storefront-pillar" });
      this.box(parent, { size: [9.34, frontGlassHeight, 0.07], pos: [x, frontGlassCenterY, 7.78], color: "#c7e4df", opacity: 0.12, name: "storefront-glass" });
      for (const edge of [-4.67, 0, 4.67]) {
        this.box(parent, { size: [0.1, frontGlassHeight, 0.12], pos: [x + edge, frontGlassCenterY, 7.84], color: "#37564d", name: "storefront-mullion" });
      }
    }
    this.box(parent, { size: [3.75, 0.055, 1.05], pos: [0, 0.035, 7.02], color: "#2b4b43", name: "entrance-mat" });

    // Storefront (front) door frame, rendered closed (progress = 0).
    const door = STOREFRONT_LAYOUT.door;
    const doorGroupY = door.leafHeight / 2;
    const doorZ = STOREFRONT_LAYOUT.z;
    for (const side of [-1, 1] as const) {
      const leafCenter = side * door.closedCenterOffset;
      this.box(parent, { size: [door.leafWidth, door.leafHeight, door.leafDepth], pos: [leafCenter, doorGroupY, doorZ], color: "#c9e9e3", opacity: 0.28, name: "storefront-leaf" });
      for (const edge of [-door.leafWidth / 2, door.leafWidth / 2]) {
        this.box(parent, { size: [0.075, door.leafHeight + 0.02, 0.1], pos: [leafCenter + edge, doorGroupY, doorZ + 0.07], color: "#294a41", name: "storefront-leaf-edge" });
      }
    }
    for (const x of [-door.outerPostX, door.outerPostX]) {
      this.box(parent, { size: [door.postWidth, door.leafHeight + 0.16, door.frameDepth], pos: [x, doorGroupY, doorZ + 0.08], color: "#294a41", name: "storefront-post" });
    }
    this.box(parent, { size: [door.outerPostX * 2 + door.postWidth * 2, 0.14, 0.15], pos: [0, doorGroupY + door.leafHeight / 2 + 0.07, doorZ + 0.08], color: "#294a41", name: "storefront-top-beam" });
    this.box(parent, { size: [0.62, 0.24, 0.2], pos: [0, doorGroupY + door.leafHeight / 2 + 0.38, doorZ + 0.02], color: "#203a33", name: "storefront-sign" });
    // Door status indicator, closed (red/orange) by default — phase 1 has no
    // door state input yet.
    this.box(parent, { size: [0.13, 0.13, 0.02], pos: [0, doorGroupY + door.leafHeight / 2 + 0.38, doorZ + 0.14], color: "#f08d73", name: "storefront-indicator" });
  }

  // ---- CityPerimeter (src/components/game/CityPerimeter.tsx) ----
  // Phase 1 covers the structural/road block-out only: ground block, roads,
  // sidewalks, crosswalks, parking bays and the ten city building volumes.
  // Decorative dressing (trees, street lights, cars, benches, bus stop) is
  // deferred — see the Phase 2 list.
  private buildCityPerimeter(parent: pc.Entity) {
    this.box(parent, { size: [54, 0.1, 64], pos: [0, -0.2, -2], color: "#abc7a6", name: "city-block" });
    this.road(parent, [36, 0.09, 3.8], [0, -0.125, -21.8], true);
    this.road(parent, [36, 0.09, 3.8], [0, -0.125, 18.25], true);
    this.road(parent, [3.8, 0.09, 43.9], [-15.85, -0.12, -1.75], false);
    this.road(parent, [3.8, 0.09, 43.9], [15.85, -0.12, -1.75], false);

    this.box(parent, { size: [26.8, 0.1, 1.1], pos: [0, -0.07, -19.4], color: "#d9d7c9", name: "sidewalk" });
    this.box(parent, { size: [26.8, 0.1, 1.1], pos: [0, -0.07, 16.05], color: "#d9d7c9", name: "sidewalk" });
    this.box(parent, { size: [1.1, 0.1, 35.4], pos: [-13.45, -0.07, -1.65], color: "#d9d7c9", name: "sidewalk" });
    this.box(parent, { size: [1.1, 0.1, 35.4], pos: [13.45, -0.07, -1.65], color: "#d9d7c9", name: "sidewalk" });

    this.crosswalk(parent, [0, -0.065, 17.95], false);
    this.crosswalk(parent, [-15.55, -0.065, 9.2], true);

    for (const x of [-11, -5.5, 5.5, 11]) this.parkingSpace(parent, x);

    const buildingColors = ["#d9a27d", "#d7c28d", "#9eb9b0", "#b79ab3", "#9cafc7", "#c9a58c"];
    const buildings: Array<[number, number, number, number, number, number]> = [
      [-10.5, 0, -26.1, 5.2, 5.3, 3.6],
      [-4.4, 0, -26.5, 4.7, 4.5, 3.2],
      [1.3, 0, -26.3, 5.1, 6.1, 3.5],
      [7.3, 0, -26, 5, 4.9, 3.4],
      [19.2, 0, -7.1, 4.6, 5.5, 3.1],
      [19.4, 0, -0.8, 4.8, 4.2, 3.2],
      [19.1, 0, 5.2, 4.5, 5.9, 3],
      [-19.1, 0, -6.2, 4.4, 4.8, 3.2],
      [-19.3, 0, 0.1, 4.8, 5.8, 3],
      [-19.1, 0, 6.7, 4.5, 4.4, 3.2],
    ];
    buildings.forEach(([x, , z, width, height, depth], index) => {
      const rotationY = Math.abs(x) > 15 ? (x > 0 ? -90 : 90) : 0;
      this.cityBuilding(parent, [x, 0, z], [width, height, depth], buildingColors[index % buildingColors.length], rotationY);
    });
  }

  private road(parent: pc.Entity, size: [number, number, number], pos: [number, number, number], horizontal: boolean) {
    const group = new pc.Entity("road");
    group.setLocalPosition(pos[0], pos[1], pos[2]);
    parent.addChild(group);
    this.box(group, { size, pos: [0, 0, 0], color: "#65716f", name: "road-surface" });
    const roadLength = horizontal ? size[0] : size[2];
    const markCount = Math.max(1, Math.floor(roadLength / 4.5));
    for (let index = 0; index < markCount; index += 1) {
      const offset = (index - (markCount - 1) / 2) * 4.5;
      if (horizontal) this.box(group, { size: [2.2, 0.018, 0.08], pos: [offset, 0.055, 0], color: "#f1df9b", name: "road-mark" });
      else this.box(group, { size: [0.08, 0.018, 2.2], pos: [0, 0.055, offset], color: "#f1df9b", name: "road-mark" });
    }
  }

  private crosswalk(parent: pc.Entity, pos: [number, number, number], rotated: boolean) {
    const group = new pc.Entity("crosswalk");
    group.setLocalPosition(pos[0], pos[1], pos[2]);
    if (rotated) group.setEulerAngles(0, 90, 0);
    parent.addChild(group);
    for (const x of [-1.25, -0.75, -0.25, 0.25, 0.75, 1.25]) {
      this.box(group, { size: [0.28, 0.025, 2.3], pos: [x, 0, 0], color: "#ecebe2", name: "crosswalk-stripe" });
    }
  }

  private parkingSpace(parent: pc.Entity, x: number) {
    const group = new pc.Entity("parking-space");
    group.setLocalPosition(x, -0.06, 20.55);
    parent.addChild(group);
    this.box(group, { size: [2.4, 0.04, 0.07], pos: [0, 0, -1.15], color: "#f2eee0", name: "parking-line" });
    this.box(group, { size: [0.07, 0.04, 2.3], pos: [-1.2, 0, 0], color: "#f2eee0", name: "parking-line" });
    this.box(group, { size: [0.07, 0.04, 2.3], pos: [1.2, 0, 0], color: "#f2eee0", name: "parking-line" });
  }

  private cityBuilding(parent: pc.Entity, pos: [number, number, number], size: [number, number, number], color: string, rotationYDeg: number) {
    const [width, height, depth] = size;
    const group = new pc.Entity("city-building");
    group.setLocalPosition(pos[0], pos[1], pos[2]);
    group.setEulerAngles(0, rotationYDeg, 0);
    parent.addChild(group);
    this.box(group, { size: [width, height, depth], pos: [0, height / 2, 0], color, name: "building-volume" });
    this.box(group, { size: [width + 0.18, 0.18, depth + 0.18], pos: [0, height + 0.09, 0], color: "#5c6965", name: "building-roof-cap" });
    this.box(group, { size: [width * 0.22, height * 0.25, 0.08], pos: [0, height * 0.125, depth / 2 + 0.05], color: "#50635d", name: "building-door" });
    this.box(group, { size: [width * 0.52, 0.16, 0.5], pos: [0, height * 0.82, depth / 2 + 0.26], color: "#efe2bd", name: "building-awning" });
  }
}
