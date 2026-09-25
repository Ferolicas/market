// Bakes the static store of a saved state into one GLB: logs into the local
// QA build with the seeded save, reads every static mesh of the live scene
// (ground, city, building, furniture shells, farm structures; nothing
// instanced, skinned, stock, screen or "dynamic:"), and writes it merged by
// material, welded and simplified to public/models/market/budget/world/<name>.glb.
//   MARKET_SEED=/tmp/market-perf/level30.json node scripts/export-static-world.mjs level30
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, join, meshopt, palette, prune, simplify, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const name = process.argv[2] ?? "level30";
const seedPath = process.env.MARKET_SEED ?? "/tmp/market-perf/level30.json";
const url = process.env.MARKET_QA_URL ?? "http://localhost:3000";
const targetTriangles = Number(process.env.WORLD_TRIANGLES ?? 90_000);
const outDir = path.join(process.cwd(), "public", "models", "market", "budget", "world");
await fs.mkdir(outDir, { recursive: true });
const seed = JSON.parse(await fs.readFile(seedPath, "utf8"));
const key = "mini-market-recovery-campaign-30-20260915";
const browser = await chromium.launch({ headless: true, executablePath: "/home/ferney_oliveros/.local/bin/google-chrome", args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ state: { ...state, revision: state.revision + 10_000 }, saveRevision: 1, pendingEvents: [] })); }, { key, state: seed });
// Read the kit unbatched (flat materials, no vertex colours) with lighter bevels.
await page.addInitScript(() => { window.__MARKET_BAKE_NO_BATCH__ = true; window.__MARKET_BAKE_LOWPOLY__ = true; });
const suffix = Date.now().toString(36);
await page.goto(`${url}?perf=1&debug=1`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("World Bake");
await page.getByLabel("Nombre de usuario").fill(`bake_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`bake.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Bake-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.locator("canvas").first().waitFor({ timeout: 120_000 });
await page.waitForTimeout(25_000);

const dump = await page.evaluate(() => {
  const scene = window.__MARKET_PERF_SCENE__?.(); if (!scene) return null;
  const groups = ["perf:ground", "perf:city", "perf:building", "perf:furniture", "perf:farm"];
  const meshes = []; const textures = new Map(); const anchors = [];
  const b64 = (array) => { let s = ""; const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength); for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  // Some source GLBs (KHR_mesh_quantization, e.g. dairy.glb) store attributes
  // as normalized Int16/Int8 arrays. Reading getX/Y/Z/W always returns the
  // real decoded value regardless of the underlying typed array, so every
  // attribute leaves the browser as plain real-unit Float32 data — the Node
  // side no longer has to guess (or mis-guess) the source type.
  const toFloatArray = (attr, size) => {
    const out = new Float32Array(attr.count * size);
    for (let i = 0; i < attr.count; i++) {
      out[i * size] = attr.getX(i);
      if (size > 1) out[i * size + 1] = attr.getY(i);
      if (size > 2) out[i * size + 2] = attr.getZ(i);
      if (size > 3) out[i * size + 3] = attr.getW(i);
    }
    return out;
  };
  const imageData = (map) => {
    const image = map.image; if (!image) return null;
    const c = document.createElement("canvas"); c.width = image.width || image.videoWidth || 1; c.height = image.height || 1;
    const ctx = c.getContext("2d"); if (!ctx) return null;
    try { ctx.drawImage(image, 0, 0); return c.toDataURL("image/webp", 0.9); } catch { return null; }
  };
  for (const groupName of groups) {
    const group = scene.getObjectByName(groupName); if (!group) continue;
    group.updateWorldMatrix(true, true);
    group.traverse((o) => {
      // Dynamic anchors: stock groups, screens, crop plots, labels.
      if (/^(retail-stock|retail-stock-screen|crop|dynamic|checkout|magnet):/.test(o.name)) anchors.push({ kind: o.name.split(":")[0], name: o.name, group: groupName, matrix: o.matrixWorld.toArray() });
      if (o.isMesh && o.geometry?.attributes?.aTroikaGlyphIndex && o.visible) {
        // Remember the dynamic group a label lives in (stock screens, machine
        // status) so the client draws those live instead of a stale bake.
        let within = null; let q = o.parent; while (q && q !== group) { if (/^(retail-stock-screen|dynamic):?/.test(q.name)) { within = q.name; break; } q = q.parent; }
        anchors.push({ kind: "text", text: o.text, fontSize: o.fontSize, color: o.color, anchorX: o.anchorX, anchorY: o.anchorY, fontWeight: o.fontWeight, group: groupName, within, matrix: o.matrixWorld.toArray() });
      }
      if (!o.isMesh || !o.visible || o.isSkinnedMesh) return;
      // Only what really moves or changes stays out of the bake: stock
      // units and their screens, transaction items, door leaves, machine
      // indicators and product flights. Counters, beds, lamps and coops are
      // static furniture.
      let p = o; while (p && p !== group) { if (/^(retail-stock|magnet|dynamic:(stock-screen|storefront-door|machine-output|machine-status))/.test(p.name) || p.visible === false) return; p = p.parent; }
      const g = o.geometry; if (!g.attributes.position || g.attributes.aTroikaGlyphIndex) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      // Tripo machines keep their own budget GLB; only remember where they stand.
      const machineMap = mats.map((m) => m?.map?.name || m?.map?.image?.src?.split("/").pop() || "").find((n) => /_basecolor\.jpg$/i.test(n));
      if (machineMap) { anchors.push({ kind: "machine", name: machineMap.replace(/_basecolor\.jpg$/i, ""), object: o.name, matrix: o.matrixWorld.toArray() }); return; }
      const groupsList = g.groups.length && Array.isArray(o.material) ? g.groups : [{ start: 0, count: g.index ? g.index.count : g.attributes.position.count, materialIndex: 0 }];
      // Static instanced furniture (uprights, rails, counter parts) is baked
      // one copy per instance; stock units were excluded above.
      const instanceMatrices = o.isInstancedMesh ? Array.from({ length: o.count }, (_, i) => { const im = new o.matrixWorld.constructor(); o.getMatrixAt(i, im); return im.premultiply(o.matrixWorld).toArray(); }) : [o.matrixWorld.toArray()];
      for (const range of groupsList) for (const matrixArray of instanceMatrices) {
        const m = mats[range.materialIndex] ?? mats[0]; if (!m || m.visible === false) continue;
        let mapKey = null;
        if (m.map) { mapKey = m.map.name || m.map.image?.src?.split("/").pop() || `tex${m.map.id}`; if (!textures.has(mapKey)) textures.set(mapKey, imageData(m.map)); }
        meshes.push({
          group: groupName, name: o.name,
          matrix: matrixArray,
          position: b64(toFloatArray(g.attributes.position, 3)), normal: g.attributes.normal ? b64(toFloatArray(g.attributes.normal, 3)) : null,
          uv: g.attributes.uv ? b64(toFloatArray(g.attributes.uv, 2)) : null, color: g.attributes.color ? { data: b64(toFloatArray(g.attributes.color, g.attributes.color.itemSize)), size: g.attributes.color.itemSize } : null,
          index: g.index ? { data: b64(g.index.array), u32: g.index.array instanceof Uint32Array } : null,
          range: { start: range.start, count: range.count },
          material: { type: m.type, color: m.color?.getHex?.() ?? 0xffffff, roughness: m.roughness ?? 1, metalness: m.metalness ?? 0, transparent: Boolean(m.transparent), opacity: m.opacity ?? 1, side: m.side, emissive: m.emissive?.getHex?.() ?? 0, emissiveIntensity: m.emissiveIntensity ?? 1, map: mapKey, vertexColors: Boolean(m.vertexColors) },
        });
      }
    });
  }
  return { meshes, textures: [...textures.entries()], anchors };
});
await browser.close();
if (!dump) throw new Error("no scene hook: build with NEXT_PUBLIC_MARKET_QA_ENABLED=1");
console.log("meshes", dump.meshes.length, "textures", dump.textures.length, "anchors", dump.anchors.length);
await fs.writeFile(path.join(outDir, `${name}.anchors.json`), JSON.stringify(dump.anchors));

// ---- Rebuild in three, transform to world space, merge by material.
const decode = (s, Ctor) => { const buf = Buffer.from(s, "base64"); return new Ctor(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); };
const byMaterial = new Map();
// World-space cell edge (the store is about 90 units across after WORLD_SCALE).
const CELL_SIZE = Number(process.env.WORLD_CELL ?? 30);

// A finite centre this far from the store's own footprint (~150 u across)
// is corrupt data, not a legitimate fixture; drop it instead of baking it.
const SANE_BOUND_UNITS = Number(process.env.WORLD_SANE_BOUND ?? 300);
const dropCounts = { nan: 0, infinite: 0, "out-of-range": 0, "empty-position": 0 };
let entered = 0;

for (const m of dump.meshes) {
  entered += 1;
  const geometry = new THREE.BufferGeometry();
  const position = decode(m.position, Float32Array);
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  if (m.normal) geometry.setAttribute("normal", new THREE.BufferAttribute(decode(m.normal, Float32Array), 3));
  if (m.uv) geometry.setAttribute("uv", new THREE.BufferAttribute(decode(m.uv, Float32Array), 2));
  if (m.color) geometry.setAttribute("color", new THREE.BufferAttribute(decode(m.color.data, Float32Array), m.color.size));
  if (m.index) geometry.setIndex(new THREE.BufferAttribute(decode(m.index.data, m.index.u32 ? Uint32Array : Uint16Array), 1));
  let part = geometry;
  const total = m.index ? geometry.index.count : position.length / 3;
  if (m.range.start !== 0 || m.range.count !== total) {
    // Only the material's range of a multi-material mesh.
    const indices = m.index ? Array.from(geometry.index.array.subarray(m.range.start, m.range.start + m.range.count)) : Array.from({ length: m.range.count }, (_, i) => m.range.start + i);
    part = geometry.toNonIndexed ? geometry.clone() : geometry;
    part.setIndex(indices);
  }
  if (!part.attributes.normal) part.computeVertexNormals();
  const matrix = new THREE.Matrix4().fromArray(m.matrix);
  part.applyMatrix4(matrix);
  if (!part.attributes.uv) part.setAttribute("uv", new THREE.BufferAttribute(new Float32Array((part.attributes.position.count) * 2), 2));
  const mat = m.material;
  const usesVertexColor = Boolean(part.attributes.color) && mat.vertexColors;
  if (!usesVertexColor) part.deleteAttribute("color");
  part.computeBoundingBox();
  const centre = part.boundingBox.getCenter(new THREE.Vector3());
  const componentsFinite = Number.isFinite(centre.x) && Number.isFinite(centre.y) && Number.isFinite(centre.z);
  const componentsNaN = Number.isNaN(centre.x) || Number.isNaN(centre.y) || Number.isNaN(centre.z);
  const outOfRange = componentsFinite && (Math.abs(centre.x) > SANE_BOUND_UNITS || Math.abs(centre.y) > SANE_BOUND_UNITS || Math.abs(centre.z) > SANE_BOUND_UNITS);
  const reason = part.attributes.position.count === 0 ? "empty-position" : componentsNaN ? "nan" : !componentsFinite ? "infinite" : outOfRange ? "out-of-range" : null;
  if (reason) {
    dropCounts[reason] += 1;
    console.warn(`[bake] descartada malla group=${m.group} name=${m.name || "(sin nombre)"} razon=${reason} centre=[${centre.x},${centre.y},${centre.z}]`);
    continue;
  }
  const cell = `${Math.floor(centre.x / CELL_SIZE)}:${Math.floor(centre.z / CELL_SIZE)}`;
  const key = JSON.stringify({ ...mat, vc: usesVertexColor, cell });
  const bucket = byMaterial.get(key) ?? { material: mat, vc: usesVertexColor, cell, parts: [] };
  bucket.parts.push(part.index ? part : part);
  byMaterial.set(key, bucket);
}
const totalDropped = Object.values(dropCounts).reduce((sum, n) => sum + n, 0);
console.log(JSON.stringify({ primitivesEntered: entered, primitivesDropped: totalDropped, dropReasons: dropCounts, materialBuckets: byMaterial.size }));

// ---- glTF document.
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene("world");
const textureCache = new Map();
for (const [k, dataUrl] of dump.textures) {
  if (!dataUrl) continue;
  const tex = doc.createTexture(k).setMimeType("image/webp").setImage(new Uint8Array(Buffer.from(dataUrl.split(",")[1], "base64")));
  textureCache.set(k, tex);
}
let triangles = 0;
const cellNodes = new Map();
for (const bucket of byMaterial.values()) {
  const merged = mergeGeometries(bucket.parts.map((p) => { const g = p.index ? p : p; return g; }), false);
  if (!merged) { console.warn("merge failed for bucket", bucket.material); continue; }
  const m = bucket.material; const c = new THREE.Color(m.color); const e = new THREE.Color(m.emissive);
  const material = doc.createMaterial().setBaseColorFactor([c.r, c.g, c.b, m.transparent ? m.opacity : 1]).setRoughnessFactor(m.roughness).setMetallicFactor(m.metalness).setDoubleSided(m.side === 2).setAlphaMode(m.transparent && m.opacity < 1 ? "BLEND" : "OPAQUE");
  if (m.emissive) material.setEmissiveFactor([e.r * m.emissiveIntensity, e.g * m.emissiveIntensity, e.b * m.emissiveIntensity]);
  if (m.type === "MeshBasicMaterial") material.setRoughnessFactor(1).setMetallicFactor(0).setEmissiveFactor([c.r, c.g, c.b]).setBaseColorFactor([0, 0, 0, m.transparent ? m.opacity : 1]);
  if (m.map && textureCache.get(m.map)) material.setBaseColorTexture(textureCache.get(m.map));
  const prim = doc.createPrimitive().setMaterial(material);
  const acc = (arr, type) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  prim.setAttribute("POSITION", acc(new Float32Array(merged.attributes.position.array), "VEC3"));
  prim.setAttribute("NORMAL", acc(new Float32Array(merged.attributes.normal.array), "VEC3"));
  prim.setAttribute("TEXCOORD_0", acc(new Float32Array(merged.attributes.uv.array), "VEC2"));
  if (bucket.vc && merged.attributes.color) prim.setAttribute("COLOR_0", acc(new Float32Array(merged.attributes.color.array), merged.attributes.color.itemSize === 4 ? "VEC4" : "VEC3"));
  const idx = merged.index ? merged.index.array : Uint32Array.from({ length: merged.attributes.position.count }, (_, i) => i);
  prim.setIndices(acc(new Uint32Array(idx), "SCALAR"));
  triangles += Math.floor(idx.length / 3);
  // One parent node per cell; `join` merges the material buckets under it
  // (after `palette` folds the flat colours) into one primitive per material.
  let cellNode = cellNodes.get(bucket.cell);
  if (!cellNode) { cellNode = doc.createNode(`cell:${bucket.cell}`); scene.addChild(cellNode); cellNodes.set(bucket.cell, cellNode); }
  const mesh = doc.createMesh().addPrimitive(prim);
  cellNode.addChild(doc.createNode().setMesh(mesh));
}
console.log("source triangles", triangles, "buckets", byMaterial.size);

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const ratio = Math.min(1, targetTriangles / Math.max(1, triangles));
await doc.transform(
  dedup(),
  weld({ tolerance: 0.0005, overwrite: true }),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: Number(process.env.WORLD_ERROR ?? 0.02), lockBorder: process.env.WORLD_LOCK_BORDER !== "0" }),
  palette({ min: 2, blockSize: 4 }),
  join({ keepNamed: false, keepMeshes: false }),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
let after = 0, prims = 0;
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) { prims += 1; after += Math.floor(p.getIndices().getCount() / 3); }
const out = path.join(outDir, `${name}.glb`);
await io.write(out, doc);
const size = (await fs.stat(out)).size;
console.log(JSON.stringify({
  out: path.relative(process.cwd(), out), triangles: after, primitives: prims,
  materials: doc.getRoot().listMaterials().length, textures: doc.getRoot().listTextures().length, kb: Math.round(size / 1024),
  primitivesEntered: entered, primitivesDropped: totalDropped, dropReasons: dropCounts, materialBuckets: byMaterial.size,
}));
