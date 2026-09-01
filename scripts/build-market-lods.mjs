import { mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize, inspect, prune, resample, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const root = process.cwd();
const modelRoot = join(root, "public", "models", "market");
const familyConfig = {
  characters: {
    lod1: { ratio: 0.3, error: 0.008, maxRenderVertices: 30_000, textureSize: 768 },
    lod2: { ratio: 0.18, error: 0.015, maxRenderVertices: 18_000, textureSize: 512 },
  },
  customers: {
    lod1: { ratio: 0.45, error: 0.008, maxRenderVertices: 20_000, textureSize: 768 },
    lod2: { ratio: 0.27, error: 0.015, maxRenderVertices: 12_000, textureSize: 512 },
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

const results = [];
for (const [family, lods] of Object.entries(familyConfig)) {
  const source = join(modelRoot, family);
  const files = (await readdir(source)).filter((name) => name.endsWith(".glb")).sort();
  for (const level of Object.keys(lods)) await mkdir(join(source, level), { recursive: true });

  for (const file of files) {
    const input = join(source, file);
    const baselineDocument = await io.read(input);
    const baseline = sceneRenderVertices(baselineDocument);

    for (const [level, config] of Object.entries(lods)) {
      const document = await io.read(input);
      removeGeneratedNormals(document);
      await document.transform(
        dequantize(),
        resample(),
        weld({ overwrite: true }),
        simplify({ simplifier: regularizedSimplifier, ratio: config.ratio, error: config.error }),
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
      const maximumRatio = config.ratio + 0.04;
      if (reduction > maximumRatio) {
        throw new Error(`${family}/${level}/${file}: ${(reduction * 100).toFixed(1)}% of source vertices exceeds ${(maximumRatio * 100).toFixed(1)}% reduction gate`);
      }

      const output = join(source, level, basename(file));
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
