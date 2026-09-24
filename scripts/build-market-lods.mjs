import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize, inspect, prune, resample, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const root = process.cwd();
const modelRoot = join(root, "public", "models", "market");
const familyConfig = {
  characters: {
    lod1: { ratio: 0.045, error: 0.02, maxRenderVertices: 30_000, textureSize: 768 },
    lod2: { ratio: 0.027, error: 0.035, maxRenderVertices: 18_000, textureSize: 512 },
  },
  customers: {
    lod1: { ratio: 0.03, error: 0.02, maxRenderVertices: 20_000, textureSize: 768 },
    lod2: { ratio: 0.018, error: 0.035, maxRenderVertices: 12_000, textureSize: 512 },
  },
  // Accessories weigh two to four bodies each on a phone (a hat is 11–33 k
  // triangles, hair 9–16 k, a LOD1 body 9 k). They sit under one body folder
  // each, so the LOD lands beside them: hats/lod1/<body>/<hat>.glb.
  // Sources range 11–33 k triangles, so a fixed target beats a fixed ratio:
  // the ratio is derived per file as min(ratio, target / source).
  hats: {
    nested: true,
    lod1: { ratio: 0.3, error: 0.02, targetRenderVertices: 10_000, maxRenderVertices: 13_000, textureSize: 512 },
    lod2: { ratio: 0.15, error: 0.035, targetRenderVertices: 5_000, maxRenderVertices: 7_000, textureSize: 256 },
  },
  hair: {
    nested: true,
    lod1: { ratio: 0.3, error: 0.02, targetRenderVertices: 9_000, maxRenderVertices: 11_000, textureSize: 512 },
    lod2: { ratio: 0.15, error: 0.035, targetRenderVertices: 4_500, maxRenderVertices: 6_000, textureSize: 256 },
  },
};

// The source cast is exported as a fully faceted triangle soup. Dropping only
// the generated face normals lets weld rebuild the real indexed topology while
// still treating UVs, skin weights and every morph POSITION delta as hard
// constraints. Regular simplification can then collapse connected edges
// without the cross-seam corruption caused by meshoptimizer's Permissive mode.
const regularizedSimplifier = {
  ready: MeshoptSimplifier.ready,
  simplify(indices, positions, stride, targetCount, targetError, flags = []) {
    return MeshoptSimplifier.simplify(
      indices,
      positions,
      stride,
      targetCount,
      targetError,
      [...new Set([...flags, "Regularize"])],
    );
  },
};

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });

// `node scripts/build-market-lods.mjs hats hair` rebuilds only those families.
const requested = new Set(process.argv.slice(2));
const results = [];
for (const [family, { nested, ...lods }] of Object.entries(familyConfig)) {
  if (requested.size && !requested.has(family)) continue;
  const source = join(modelRoot, family);
  const folders = nested ? (await readdir(source, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith("lod")).map((entry) => entry.name).sort() : [""];
  const files = (await Promise.all(folders.map(async (folder) => (await readdir(join(source, folder))).filter((name) => name.endsWith(".glb")).sort().map((name) => join(folder, name))))).flat();
  for (const level of Object.keys(lods)) for (const folder of folders) await mkdir(join(source, level, folder), { recursive: true });

  for (const file of files) {
    const input = join(source, file);
    const baselineDocument = await io.read(input);
    const baseline = sceneRenderVertices(baselineDocument);

    for (const [level, config] of Object.entries(lods)) {
      const document = await io.read(input);
      removeGeneratedNormals(document);
      const ratio = config.targetRenderVertices ? Math.min(config.ratio, config.targetRenderVertices / baseline) : config.ratio;
      await document.transform(
        dequantize(),
        resample(),
        weld({ overwrite: true }),
        simplify({ simplifier: regularizedSimplifier, ratio, error: config.error }),
        textureCompress({
          encoder: sharp,
          targetFormat: "webp",
          resize: [config.textureSize, config.textureSize],
          quality: level === "lod1" ? 84 : 78,
          effort: 5,
        }),
        prune(),
      );
      rebuildSmoothNormals(document);

      const renderVertices = sceneRenderVertices(document);
      const reduction = renderVertices / baseline;
      if (renderVertices > config.maxRenderVertices) {
        throw new Error(`${family}/${level}/${file}: ${renderVertices.toLocaleString()} render vertices exceeds ${config.maxRenderVertices.toLocaleString()}`);
      }
      // A count budget alone can accidentally pass when a source model changes
      // to something much smaller. Keep a relative gate so every LOD proves it
      // still removes meaningful work from its own source.
      const maximumRatio = ratio + 0.04;
      if (reduction > maximumRatio) {
        throw new Error(`${family}/${level}/${file}: ${(reduction * 100).toFixed(1)}% of source vertices exceeds ${(maximumRatio * 100).toFixed(1)}% reduction gate`);
      }

      const output = join(source, level, file);
      await io.write(output, document);
      results.push({
        asset: `${family}/${level}/${file}`,
        sourceRenderVertices: baseline,
        renderVertices,
        reductionPercent: Number(((1 - reduction) * 100).toFixed(1)),
        budget: config.maxRenderVertices,
      });
    }
  }
}

console.log(JSON.stringify({ generated: results.length, results }, null, 2));

function sceneRenderVertices(document) {
  return inspect(document).scenes.properties.reduce((sum, scene) => sum + scene.renderVertexCount, 0);
}

function removeGeneratedNormals(document) {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      primitive.setAttribute("NORMAL", null);
      for (const target of primitive.listTargets()) target.setAttribute("NORMAL", null);
    }
  }
}

/** Area-weighted indexed normals keep the inflated character shading smooth
 * without unwelding the mesh back into the source's 90k-vertex triangle soup.
 * Morph POSITION deltas remain intact; their tiny facial poses reuse the base
 * normal field instead of carrying sixteen redundant normal-delta streams. */
function rebuildSmoothNormals(document) {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      const indices = primitive.getIndices()?.getArray();
      if (!position || !indices || indices.length % 3 !== 0) continue;
      const positions = position.getArray();
      if (!(positions instanceof Float32Array)) throw new Error(`${mesh.getName()}: expected dequantized Float32 positions`);
      const normals = new Float32Array(position.getCount() * 3);
      for (let offset = 0; offset < indices.length; offset += 3) {
        const a = indices[offset] * 3;
        const b = indices[offset + 1] * 3;
        const c = indices[offset + 2] * 3;
        const abx = positions[b] - positions[a];
        const aby = positions[b + 1] - positions[a + 1];
        const abz = positions[b + 2] - positions[a + 2];
        const acx = positions[c] - positions[a];
        const acy = positions[c + 1] - positions[a + 1];
        const acz = positions[c + 2] - positions[a + 2];
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        for (const vertex of [a, b, c]) {
          normals[vertex] += nx;
          normals[vertex + 1] += ny;
          normals[vertex + 2] += nz;
        }
      }
      for (let offset = 0; offset < normals.length; offset += 3) {
        const length = Math.hypot(normals[offset], normals[offset + 1], normals[offset + 2]);
        if (length <= Number.EPSILON) continue;
        normals[offset] /= length;
        normals[offset + 1] /= length;
        normals[offset + 2] /= length;
      }
      primitive.setAttribute("NORMAL", document.createAccessor().setType("VEC3").setArray(normals));
    }
  }
}
