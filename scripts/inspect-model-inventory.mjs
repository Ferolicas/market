import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const targets = process.argv.slice(2);
const rows = [];
for (const target of targets) {
  const files = statSync(target).isDirectory() ? readdirSync(target).filter((f) => f.endsWith(".glb")).map((f) => join(target, f)) : [target];
  for (const file of files) {
    const doc = await io.read(file); const root = doc.getRoot();
    let tris = 0, verts = 0, prims = 0;
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
      prims += 1; const idx = prim.getIndices(); const pos = prim.getAttribute("POSITION");
      const count = idx ? idx.getCount() : pos.getCount(); tris += Math.floor(count / 3); verts += pos.getCount();
    }
    const tex = root.listTextures().map((t) => `${t.getMimeType().replace("image/", "")}:${(t.getSize() || []).join("x")}:${Math.round(t.getImage().byteLength / 1024)}k`);
    rows.push({ file: file.replace("public/models/market/", ""), kb: Math.round(statSync(file).size / 1024), tris, verts, prims, materials: root.listMaterials().length, skins: root.listSkins().length, anims: root.listAnimations().length, tex: tex.join(" ") });
  }
}
rows.sort((a, b) => b.tris - a.tris);
for (const r of rows) console.log(`${String(r.tris).padStart(7)} tris ${String(r.verts).padStart(7)} v ${String(r.prims).padStart(3)} prim ${String(r.materials).padStart(3)} mat ${String(r.kb).padStart(6)} kB skins ${r.skins} anims ${r.anims}  ${r.file}  [${r.tex}]`);
console.log("TOTAL tris", rows.reduce((n, r) => n + r.tris, 0), "files", rows.length, "kB", rows.reduce((n, r) => n + r.kb, 0));
