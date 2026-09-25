// Budget variants of every model the level-30 demonstration draws:
// characters ≤ 3 000 triangles, crowd bodies ≤ 2 500, hats/hair ≤ 600,
// product units ≤ 120, machines ≤ 2 500, kit pieces and crops decimated.
// Output: public/models/market/budget/<family>/<same path>. Crowd bodies lose
// their clips and morphs (they animate from baked bone textures).
//   node scripts/build-budget-assets.mjs [family ...]
import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize, meshopt, prune, resample, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const modelRoot = join(process.cwd(), "public", "models", "market");
const outRoot = join(modelRoot, "budget");
const CHARACTER_BODY = { triangles: 2_200, error: 0.05, texture: 1024, stripAnimations: true, stripMorphs: true };
const CROWD_BODY = { triangles: 1_600, error: 0.05, texture: 512, stripAnimations: true, stripMorphs: true };
const ACCESSORY = { triangles: 600, error: 1, texture: 256, prune: true };
const families = {
  characters: { files: ["owner_man.glb", "owner_woman.glb", "owner_boy.glb", "owner_girl.glb"], config: () => CHARACTER_BODY },
  customers: { config: () => CROWD_BODY },
  hats: { nested: true, config: () => ACCESSORY },
  hair: { nested: true, config: () => ACCESSORY },
  delivered: {
    config: (name) => ({
      milk: { triangles: 120, error: 0.2 }, cheese: { triangles: 100, error: 0.2 }, egg: { triangles: 60, error: 0.2 },
      dairy: { triangles: 2_500, error: 0.3, prune: true }, "egg-display": { triangles: 2_500, error: 0.3, prune: true }, oven: { triangles: 2_500, error: 0.3, prune: true },
      juicer: { triangles: 2_000, error: 0.3, prune: true }, mill: { triangles: 1_500, error: 0.3, prune: true },
      chicken: { triangles: 2_500, error: 0.12 }, cow: { triangles: 2_500, error: 0.12 },
    }[name] ?? { triangles: 2_000, error: 0.12 }),
  },
  environment: {
    config: (name) => {
      if (/^(corn|tomato)_(growing|ripe)$/.test(name)) return { triangles: 1_500, error: 0.3 };
      if (/^wheat_(growing|ripe)$/.test(name)) return { triangles: 1_000, error: 0.3 };
      if (/_(sprout|small)$/.test(name)) return { triangles: 600, error: 0.3 };
      if (/_harvest_item$/.test(name)) return { triangles: 400, error: 0.3 };
      if (name === "cow_character") return { triangles: 2_000, error: 0.2 };
      if (name === "chicken_character") return { triangles: 1_500, error: 0.2 };
      if (name === "farm_plot_seeded") return { triangles: 800, error: 0.2 };
      // Flat-coloured kit pieces: keep half the bevel geometry.
      return { ratio: 0.5, error: 0.01 };
    },
  },
};

const regularizedSimplifier = {
  ready: MeshoptSimplifier.ready,
  simplify(indices, positions, stride, targetCount, targetError, flags = []) {
    return MeshoptSimplifier.simplify(indices, positions, stride, targetCount, targetError, [...new Set([...flags, "Regularize"])]);
  },
};
// Accessories and machines are many disconnected shells; pruning small
// components is the only way below a few thousand triangles.
const pruningSimplifier = {
  ready: MeshoptSimplifier.ready,
  simplify(indices, positions, stride, targetCount, targetError, flags = []) {
    return MeshoptSimplifier.simplify(indices, positions, stride, targetCount, targetError, [...new Set([...flags, "Regularize", "Prune"])]);
  },
};
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

function triangleCount(document) {
  let total = 0;
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const indices = primitive.getIndices();
    total += Math.floor((indices ? indices.getCount() : primitive.getAttribute("POSITION").getCount()) / 3);
  }
  return total;
}

function stripAnimationsAndMorphs(document, { stripAnimations, stripMorphs }) {
  const root = document.getRoot();
  if (stripAnimations) for (const animation of root.listAnimations()) {
    // Disposing the animation alone leaves its samplers and channels (and a
    // megabyte of keyframe accessors) in the file.
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) sampler.dispose();
    animation.dispose();
  }
  if (stripMorphs) for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) for (const target of primitive.listTargets()) primitive.removeTarget(target);
    mesh.setWeights([]);
  }
}

function removeGeneratedNormals(document) {
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    primitive.setAttribute("NORMAL", null);
    for (const target of primitive.listTargets()) target.setAttribute("NORMAL", null);
  }
}

function rebuildSmoothNormals(document) {
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute("POSITION");
    const indices = primitive.getIndices()?.getArray();
    if (!position || !indices || indices.length % 3 !== 0) continue;
    const positions = position.getArray();
    const normals = new Float32Array(position.getCount() * 3);
    for (let offset = 0; offset < indices.length; offset += 3) {
      const a = indices[offset] * 3, b = indices[offset + 1] * 3, c = indices[offset + 2] * 3;
      const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
      const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
      const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      for (const vertex of [a, b, c]) { normals[vertex] += nx; normals[vertex + 1] += ny; normals[vertex + 2] += nz; }
    }
    for (let offset = 0; offset < normals.length; offset += 3) {
      const length = Math.hypot(normals[offset], normals[offset + 1], normals[offset + 2]);
      if (length > Number.EPSILON) { normals[offset] /= length; normals[offset + 1] /= length; normals[offset + 2] /= length; }
    }
    primitive.setAttribute("NORMAL", document.createAccessor().setType("VEC3").setArray(normals));
  }
}

async function listFiles(family, { nested, files }) {
  const source = join(modelRoot, family);
  if (files) return files;
  if (!nested) return (await readdir(source)).filter((name) => name.endsWith(".glb")).sort();
  const folders = (await readdir(source, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith("lod")).map((entry) => entry.name).sort();
  return (await Promise.all(folders.map(async (folder) => (await readdir(join(source, folder))).filter((name) => name.endsWith(".glb")).sort().map((name) => join(folder, name))))).flat();
}

const requested = new Set(process.argv.slice(2));
const results = [];
for (const [family, spec] of Object.entries(families)) {
  if (requested.size && !requested.has(family)) continue;
  for (const file of await listFiles(family, spec)) {
    const input = join(modelRoot, family, file);
    const output = join(outRoot, family, file);
    await mkdir(dirname(output), { recursive: true });
    const document = await io.read(input);
    const name = file.replace(/^.*\//, "").replace(/\.glb$/, "");
    const config = spec.config(name);
    const before = triangleCount(document);
    stripAnimationsAndMorphs(document, config);
    const hasSkin = document.getRoot().listSkins().length > 0;
    if (hasSkin) removeGeneratedNormals(document);
    const ratio = config.ratio ?? Math.min(1, config.triangles / Math.max(1, before));
    // Accessories are shells of disconnected strands: a coarser weld joins
    // them so the collapse can cross what used to be seams.
    const transforms = [dequantize(), resample(), weld({ overwrite: true, tolerance: config.prune ? 0.002 : undefined }), simplify({ simplifier: config.prune ? pruningSimplifier : regularizedSimplifier, ratio, error: config.error })];
    if (config.texture) transforms.push(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [config.texture, config.texture], quality: 80, effort: 5 }));
    transforms.push(prune());
    await document.transform(...transforms);
    if (hasSkin) rebuildSmoothNormals(document);
    await document.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    await io.write(output, document);
    const after = triangleCount(document);
    const size = (await stat(output)).size;
    results.push({ file: relative(modelRoot, output), before, after, kb: Math.round(size / 1024) });
    console.log(`${String(before).padStart(7)} -> ${String(after).padStart(6)} tris ${String(Math.round(size / 1024)).padStart(5)} kB  ${relative(modelRoot, output)}`);
  }
}
console.log(JSON.stringify({ generated: results.length, triangles: results.reduce((n, r) => n + r.after, 0), kb: results.reduce((n, r) => n + r.kb, 0) }));
