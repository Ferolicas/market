import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

// The supplied mosaic exports contain frame, wall and glass in one opaque
// primitive. Rebuild only the Unity runtime copies from the untouched
// GameAssets sources, then split glass triangles into a transparent primitive.
// Positions, normals, UVs, colours and topology remain values from the source;
// only triangle grouping and the glass material differ.
const here = dirname(fileURLToPath(import.meta.url));
const unity = resolve(here, '..');
const project = resolve(unity, '..', '..');
const streaming = resolve(unity, 'Assets/StreamingAssets');
const catalogPath = resolve(streaming, 'Data/runtime-asset-catalog.json');
const manifestPath = resolve(unity, 'ASSET_SHA256SUMS.txt');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const sourcePaths = {
  StorefrontWindow: resolve(project, 'GameAssets/Environment/Runtime/Furniture/StorefrontWindow.glb'),
  AutomaticDoor: resolve(project, 'GameAssets/Environment/Runtime/Furniture/AutomaticDoor.glb'),
};

function wrap(value) {
  return ((value % 1) + 1) % 1;
}

function isGlassPixel(decoded, u, v) {
  const x = Math.min(decoded.info.width - 1, Math.floor(wrap(u) * decoded.info.width));
  const y = Math.min(decoded.info.height - 1, Math.max(0, Math.floor((1 - wrap(v)) * decoded.info.height)));
  const offset = (y * decoded.info.width + x) * decoded.info.channels;
  const red = decoded.data[offset];
  const green = decoded.data[offset + 1];
  const blue = decoded.data[offset + 2];
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return maximum - minimum <= 10 && luminance >= 145 && luminance <= 246;
}

function makeIndexArray(indices, values) {
  if (indices instanceof Uint8Array) return new Uint8Array(values);
  if (indices instanceof Uint16Array) return new Uint16Array(values);
  return new Uint32Array(values);
}

function copyTexCoord(sourceInfo, targetInfo) {
  if (sourceInfo && targetInfo) targetInfo.setTexCoord(sourceInfo.getTexCoord());
}

function levelMosaicYaw(node) {
  const position = node.getMesh()?.listPrimitives()[0]?.getAttribute('POSITION')?.getArray();
  if (!position?.length) return 0;
  const count = position.length / 3;
  let meanX = 0;
  let meanZ = 0;
  for (let offset = 0; offset < position.length; offset += 3) {
    meanX += position[offset];
    meanZ += position[offset + 2];
  }
  meanX /= count;
  meanZ /= count;
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (let offset = 0; offset < position.length; offset += 3) {
    const x = position[offset] - meanX;
    const z = position[offset + 2] - meanZ;
    xx += x * x;
    zz += z * z;
    xz += x * z;
  }
  // The dominant horizontal axis should become glTF +X. The source scans
  // were exported at an isometric yaw, so preserving that yaw before a
  // non-uniform size fit sheared every facade module.
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
  node.setRotation([0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]);
  return angle * 180 / Math.PI;
}

for (const id of Object.keys(sourcePaths)) {
  const entry = catalog.entries.find(candidate => candidate.id === id);
  if (!entry) throw new Error(`Missing runtime asset: ${id}`);
  const targetPath = resolve(streaming, entry.path);
  const document = await io.read(sourcePaths[id]);
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer(`${id}_Buffer`);
  const correctedYaw = document.getRoot().listNodes().map(levelMosaicYaw).find(angle => Math.abs(angle) > 0.01) ?? 0;
  let opaqueTriangles = 0;
  let glassTriangles = 0;

  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of [...mesh.listPrimitives()]) {
      if (primitive.getMode() !== 4) continue;
      const sourceIndices = primitive.getIndices()?.getArray();
      const uv = primitive.getAttribute('TEXCOORD_0')?.getArray();
      const material = primitive.getMaterial();
      const texture = material?.getBaseColorTexture();
      if (!sourceIndices || !uv || !material || !texture?.getImage()) continue;

      const decoded = await sharp(texture.getImage()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const opaque = [];
      const glass = [];
      for (let offset = 0; offset < sourceIndices.length; offset += 3) {
        let score = 0;
        let centroidU = 0;
        let centroidV = 0;
        for (let corner = 0; corner < 3; corner++) {
          const vertex = sourceIndices[offset + corner];
          const u = uv[vertex * 2];
          const v = uv[vertex * 2 + 1];
          centroidU += u;
          centroidV += v;
          if (isGlassPixel(decoded, u, v)) score++;
        }
        if (isGlassPixel(decoded, centroidU / 3, centroidV / 3)) score += 2;
        const destination = score >= 3 ? glass : opaque;
        destination.push(sourceIndices[offset], sourceIndices[offset + 1], sourceIndices[offset + 2]);
      }
      if (!glass.length || !opaque.length) continue;

      material.setAlphaMode('OPAQUE').setAlpha(1).setDoubleSided(false);
      primitive.getIndices().setArray(makeIndexArray(sourceIndices, opaque));
      opaqueTriangles += opaque.length / 3;

      const glassMaterial = document.createMaterial(`${id}_Glass`)
        .setBaseColorFactor([1, 1, 1, 0.18])
        .setBaseColorTexture(texture)
        .setMetallicFactor(0)
        .setRoughnessFactor(0.22)
        .setAlphaMode('BLEND')
        .setDoubleSided(true);
      if (material.getNormalTexture()) {
        glassMaterial.setNormalTexture(material.getNormalTexture()).setNormalScale(Math.min(0.2, material.getNormalScale()));
      }
      copyTexCoord(material.getBaseColorTextureInfo(), glassMaterial.getBaseColorTextureInfo());

      const glassPrimitive = document.createPrimitive().setMode(primitive.getMode()).setMaterial(glassMaterial);
      const semantics = primitive.listSemantics();
      const attributes = primitive.listAttributes();
      semantics.forEach((semantic, index) => glassPrimitive.setAttribute(semantic, attributes[index]));
      primitive.listTargets().forEach(target => glassPrimitive.addTarget(target));
      glassPrimitive.setIndices(document.createAccessor(`${id}_GlassIndices`, buffer).setType('SCALAR').setArray(makeIndexArray(sourceIndices, glass)));
      mesh.addPrimitive(glassPrimitive);
      glassTriangles += glass.length / 3;
    }
  }

  await io.write(targetPath, document);
  const bytes = await readFile(targetPath);
  entry.bytes = bytes.byteLength;
  entry.sha256 = createHash('sha256').update(bytes).digest('hex');
  console.log(`${id}: yaw ${correctedYaw.toFixed(2)}°, ${opaqueTriangles} opaque triangles, ${glassTriangles} glass triangles, ${entry.bytes} bytes`);
}

catalog.totalBytes = catalog.entries.reduce((total, entry) => total + entry.bytes, 0);
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
await writeFile(manifestPath, catalog.entries.slice().sort((a, b) => a.path.localeCompare(b.path)).map(entry => `${entry.sha256}  Assets/StreamingAssets/${entry.path}\n`).join(''), 'utf8');
