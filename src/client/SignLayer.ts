import * as THREE from "three";

/**
 * Every piece of text and every stock screen in the store drawn as one
 * instanced quad mesh over a single canvas atlas: department signs, station
 * labels, shelf counters. A label is a cell of the atlas; updating its text
 * repaints that cell only. One draw call, no SDF fonts, no React.
 */
const ATLAS_SIZE = 2048;
const CELL_WIDTH = 256;
const CELL_HEIGHT = 64;
const COLUMNS = ATLAS_SIZE / CELL_WIDTH;
const ROWS = ATLAS_SIZE / CELL_HEIGHT;
const CAPACITY = COLUMNS * ROWS;

export interface LabelStyle {
  color?: string;
  background?: string | null;
  /** Font size in world units of the quad's height (text fills the cell). */
  fontSize: number;
  weight?: number;
  align?: "center" | "left";
  /** Extra quad width in world units; the text width is measured otherwise. */
  width?: number;
}

export interface SignHandle {
  index: number;
}

const quadGeometry = new THREE.PlaneGeometry(1, 1);

export class SignLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly cellRect: THREE.InstancedBufferAttribute;
  private readonly matrices: THREE.Matrix4[] = [];
  private readonly styles: LabelStyle[] = [];
  private readonly texts: string[] = [];
  private count = 0;
  private dirty = false;
  /** Cells repainted since the last flush; uploaded one by one, never the whole atlas. */
  private readonly dirtyCells = new Set<number>();
  private uploadedOnce = false;
  private readonly cellCanvas: HTMLCanvasElement;
  private readonly cellTexture: THREE.CanvasTexture;
  private readonly copyRegion = new THREE.Box2();
  private readonly copyTarget = new THREE.Vector2();

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ATLAS_SIZE;
    this.canvas.height = ATLAS_SIZE;
    this.context = this.canvas.getContext("2d", { alpha: true })!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.anisotropy = 4;
    this.cellCanvas = document.createElement("canvas");
    this.cellCanvas.width = CELL_WIDTH;
    this.cellCanvas.height = CELL_HEIGHT;
    this.cellTexture = new THREE.CanvasTexture(this.cellCanvas);
    this.cellTexture.colorSpace = THREE.SRGBColorSpace;
    this.cellTexture.generateMipmaps = false;
    this.cellTexture.minFilter = THREE.LinearFilter;
    this.cellTexture.flipY = true;
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    material.alphaTest = 0.02;
    this.cellRect = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
    const geometry = quadGeometry.clone();
    geometry.setAttribute("aCellRect", this.cellRect);
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aCellRect;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv = aCellRect.xy + vMapUv * aCellRect.zw;");
    };
    this.mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = "client:signs";
  }

  /** Adds a label whose quad centre and orientation come from `matrix`
   * (world units; the quad faces its local +Z, one unit tall before scale). */
  add(text: string, style: LabelStyle, matrix: THREE.Matrix4): SignHandle {
    if (this.count >= CAPACITY) throw new Error("sign atlas full");
    const index = this.count;
    this.count += 1;
    this.styles[index] = style;
    this.texts[index] = text;
    this.matrices[index] = matrix.clone();
    this.paint(index);
    this.place(index);
    this.mesh.count = this.count;
    return { index };
  }

  update(handle: SignHandle, text: string, style?: Partial<LabelStyle>) {
    const current = this.styles[handle.index];
    const styleChanged = Boolean(style) && Object.entries(style!).some(([key, value]) => current[key as keyof LabelStyle] !== value);
    if (this.texts[handle.index] === text && !styleChanged) return;
    this.texts[handle.index] = text;
    if (styleChanged) this.styles[handle.index] = { ...current, ...style };
    this.paint(handle.index);
    this.place(handle.index);
  }

  private cellOrigin(index: number) {
    return { x: (index % COLUMNS) * CELL_WIDTH, y: Math.floor(index / COLUMNS) * CELL_HEIGHT };
  }

  private measure(index: number) {
    const style = this.styles[index];
    const text = this.texts[index];
    const context = this.context;
    context.font = `${style.weight ?? 800} ${Math.floor(CELL_HEIGHT * 0.72)}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    const textWidth = Math.min(CELL_WIDTH - 12, context.measureText(text).width);
    return { textWidth, aspect: (textWidth + 12) / CELL_HEIGHT };
  }

  private paint(index: number) {
    const { x, y } = this.cellOrigin(index);
    const style = this.styles[index];
    const text = this.texts[index];
    const context = this.context;
    context.clearRect(x, y, CELL_WIDTH, CELL_HEIGHT);
    const { textWidth } = this.measure(index);
    const used = Math.min(CELL_WIDTH, textWidth + 12);
    if (style.background) {
      context.fillStyle = style.background;
      context.fillRect(x, y, used, CELL_HEIGHT);
    }
    context.fillStyle = style.color ?? "#ffffff";
    context.textBaseline = "middle";
    context.textAlign = "center";
    context.fillText(text, x + used / 2, y + CELL_HEIGHT / 2 + 2, CELL_WIDTH - 12);
    this.cellRect.setXYZW(index, x / ATLAS_SIZE, 1 - (y + CELL_HEIGHT) / ATLAS_SIZE, used / ATLAS_SIZE, CELL_HEIGHT / ATLAS_SIZE);
    this.cellRect.needsUpdate = true;
    this.dirty = true;
    this.dirtyCells.add(index);
  }

  private static readonly scratch = { matrix: new THREE.Matrix4(), scale: new THREE.Matrix4() };

  private place(index: number) {
    const style = this.styles[index];
    const { aspect } = this.measure(index);
    const height = style.fontSize * 1.28;
    const width = style.width ?? height * aspect;
    const scratch = SignLayer.scratch;
    scratch.scale.makeScale(width, height, 1);
    scratch.matrix.multiplyMatrices(this.matrices[index], scratch.scale);
    this.mesh.setMatrixAt(index, scratch.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Uploads what changed: the whole atlas the first time, then only the
   * repainted cells (a 256×64 copy each, not a 16 MB re-upload). */
  flush(renderer: THREE.WebGLRenderer) {
    if (!this.dirty) return;
    this.dirty = false;
    if (!this.uploadedOnce) {
      this.uploadedOnce = true;
      this.dirtyCells.clear();
      this.texture.needsUpdate = true;
      return;
    }
    const context = this.cellCanvas.getContext("2d")!;
    for (const index of this.dirtyCells) {
      const { x, y } = this.cellOrigin(index);
      context.clearRect(0, 0, CELL_WIDTH, CELL_HEIGHT);
      context.drawImage(this.canvas, x, y, CELL_WIDTH, CELL_HEIGHT, 0, 0, CELL_WIDTH, CELL_HEIGHT);
      this.cellTexture.needsUpdate = true;
      // The atlas is stored flipped (flipY); its row `y` from the top sits at
      // ATLAS_SIZE - y - CELL_HEIGHT from the bottom, and the cell is copied
      // unflipped so it lands the same way up.
      this.copyRegion.min.set(0, 0);
      this.copyRegion.max.set(CELL_WIDTH, CELL_HEIGHT);
      this.copyTarget.set(x, ATLAS_SIZE - y - CELL_HEIGHT);
      renderer.copyTextureToTexture(this.cellTexture, this.texture, this.copyRegion, this.copyTarget);
    }
    this.dirtyCells.clear();
  }

  dispose() {
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
