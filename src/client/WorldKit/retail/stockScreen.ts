import * as THREE from "three";
import type { ProductId } from "@/game/types";
import { RETAIL_DEPARTMENTS, PRODUCT_RETAIL_DEPARTMENT } from "@/game/stations/retail-layout";
import { makeBox, makeText, palette, updateText, type Position } from "../primitives";
import { buildBasketProductMesh } from "./basketProduct";

/**
 * Live product "photo" panel — port of `StockScreen` from MarketKit.tsx.
 * The source renders `<RenderTexture frames={1}>`: a mini scene (camera +
 * lights + one `BasketProduct`) rendered ONCE into a small texture; only the
 * two counter texts change afterwards. Here that one-shot render is done
 * with a plain `THREE.WebGLRenderTarget` using the renderer `ClientRuntime`
 * already owns (WorldKit has no renderer of its own), passed in explicitly.
 */

export const PRODUCTS_LABELS: Record<ProductId, string> = {
  cannedCorn: "MAÍZ EN LATA",
  tomatoes: "TOMATES",
  apples: "MANZANAS",
  oranges: "NARANJAS",
  corn: "MAÍZ",
  eggs: "HUEVOS",
  milk: "LECHE",
  cheese: "QUESO",
  juice: "ZUMOS",
  bread: "PAN",
  flour: "HARINA",
  wheat: "TRIGO",
  coffee: "CAFÉ",
};

/** Ground azimuth of the fixed overview camera (OVERVIEW_CAMERA_OFFSET
 * x/z): every shelf tag turns to it so its counter reads from the play
 * view. Copied verbatim from MarketKit.tsx. */
const CAMERA_AZIMUTH = Math.atan2(16, 25.75);

// The frame/body boxes use `makeBox` (palette-aware, textured surfaces). The
// remaining planes use bespoke emissive materials with no palette-surface
// equivalent, so they are built directly, matching the source's inline
// `meshStandardMaterial`s.
function screenBackgroundMaterial() { return new THREE.MeshStandardMaterial({ color: "#0f1e23", emissive: "#12303a", emissiveIntensity: 0.55, roughness: 0.35 }); }
function accentBarMaterial(accent: string) { return new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.35, roughness: 0.5 }); }
function photoMaterial(texture: THREE.Texture) { return new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }); }
const indicatorMaterial = new THREE.MeshBasicMaterial({ color: "#5bf08a", toneMapped: false });

const photoScene = new THREE.Scene();
const photoCamera = new THREE.PerspectiveCamera(30, 1, 0.05, 5);
photoCamera.position.set(0, 0.05, 0.46);
const photoAmbient = new THREE.AmbientLight(0xffffff, 1.4);
const photoKeyLight = new THREE.DirectionalLight(0xffffff, 2.2);
photoKeyLight.position.set(1.2, 2, 1.6);
const photoFillLight = new THREE.DirectionalLight(0xffffff, 0.7);
photoFillLight.position.set(-1.4, 0.6, -0.8);
photoScene.add(photoAmbient, photoKeyLight, photoFillLight);

/** Renders one product's photo into a fresh 160x160 render target — called
 * once per stock screen (frames={1} in the source). */
function renderProductPhoto(renderer: THREE.WebGLRenderer, productId: ProductId, deliveredScene?: THREE.Object3D): THREE.Texture {
  const target = new THREE.WebGLRenderTarget(160, 160, { colorSpace: THREE.SRGBColorSpace, generateMipmaps: false });
  const subject = new THREE.Group();
  subject.rotation.set(0.28, -0.7, 0);
  subject.add(buildBasketProductMesh(productId, { scale: 1 }, deliveredScene));
  photoScene.add(subject);
  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(photoScene, photoCamera);
  renderer.setRenderTarget(previousTarget);
  photoScene.remove(subject);
  return target.texture;
}

export interface StockScreenParams {
  productId: ProductId;
  count: number;
  capacity: number;
  position: Position;
  fixtureYaw?: number;
  /** Required when `productId` is milk/cheese/eggs — the loaded GLB scene
   * from `deliveredStock.ts`'s `loadDeliveredStockAssets()` (`assets.scenes`,
   * keyed by GLB id: "milk" | "cheese" | "egg"). */
  deliveredScene?: THREE.Object3D;
}

export interface StockScreenHandle {
  group: THREE.Group;
  /** Updates only the two live counter texts — the photo never changes
   * once rendered, exactly like the source. */
  update(count: number, capacity: number): void;
}

export function buildStockScreen(renderer: THREE.WebGLRenderer, params: StockScreenParams): StockScreenHandle {
  const { productId, position, fixtureYaw = 0, deliveredScene } = params;
  const accent = RETAIL_DEPARTMENTS[PRODUCT_RETAIL_DEPARTMENT[productId]].color;

  const group = new THREE.Group();
  group.name = `retail-stock-screen:${productId}`;
  group.position.set(...position);
  group.rotation.order = "YXZ";
  group.rotation.set(-0.35, CAMERA_AZIMUTH - THREE.MathUtils.degToRad(fixtureYaw), 0);

  group.add(makeBox({ args: [0.06, 0.16, 0.06], position: [0, -0.5, -0.03], color: palette.frame, radius: 0.01 }));
  group.add(makeBox({ args: [0.76, 0.86, 0.06], position: [0, 0, -0.03], color: "#1a2325", radius: 0.04 }));

  const background = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.78), screenBackgroundMaterial());
  background.position.set(0, 0, 0.004);
  group.add(background);

  const accentBar = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.06), accentBarMaterial(accent));
  accentBar.position.set(0, 0.405, 0.006);
  group.add(accentBar);

  const texture = renderProductPhoto(renderer, productId, deliveredScene);
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), photoMaterial(texture));
  photo.position.set(0, 0.13, 0.008);
  group.add(photo);

  const label = makeText({ text: PRODUCTS_LABELS[productId], position: [0, 0.34, 0.01], fontSize: 0.07, color: "#e9f6f2", anchorX: "center", anchorY: "middle", fontWeight: 800 });
  group.add(label);

  const dynamic = new THREE.Group();
  dynamic.name = "dynamic:stock-screen";
  const countText = makeText({ text: "", position: [0, -0.16, 0.01], fontSize: 0.15, color: "#ffffff", anchorX: "center", anchorY: "middle", fontWeight: 800 });
  const statusText = makeText({ text: "", position: [0, -0.325, 0.01], fontSize: 0.082, color: "#ffcf6b", anchorX: "center", anchorY: "middle", fontWeight: 800 });
  dynamic.add(countText, statusText);
  group.add(dynamic);

  const indicator = new THREE.Mesh(new THREE.CircleGeometry(0.014, 10), indicatorMaterial);
  indicator.position.set(0.29, 0.405, 0.012);
  group.add(indicator);

  const update = (count: number, capacity: number) => {
    const missing = Math.max(0, capacity - count);
    const full = capacity > 0 && missing === 0;
    updateText(countText, { text: `${count}/${capacity}` });
    updateText(statusText, { text: full ? "LLENO" : `faltan ${missing}`, color: full ? "#8ce6a1" : "#ffcf6b" });
  };
  update(params.count, params.capacity);

  return { group, update };
}
