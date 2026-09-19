// Prepares public assets for the Godot project: decodes EXT_meshopt_compression
// and KHR_mesh_quantization (Godot's glTF importer reads neither), then copies
// audio, textures and fonts. Output: godot/assets/** (mirrors public/**).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(root, "godot", "assets");
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

let converted = 0;
for (const file of walk(path.join(root, "public", "models"))) {
  if (!file.endsWith(".glb")) continue;
  const rel = path.relative(path.join(root, "public"), file);
  const out = path.join(outRoot, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(file).mtimeMs && !process.argv.includes("--force")) continue;
  const document = await io.read(file);
  await document.transform(dequantize());
  for (const ext of document.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === "EXT_meshopt_compression" || ext.extensionName === "KHR_mesh_quantization") ext.dispose();
  }
  fs.writeFileSync(out, await io.writeBinary(document));
  converted += 1;
}

for (const dir of ["audio", "textures", "fonts"]) {
  for (const file of walk(path.join(root, "public", dir))) {
    const rel = path.relative(path.join(root, "public"), file);
    const out = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(file, out);
  }
}
console.log(`godot assets ready (${converted} glb converted)`);
