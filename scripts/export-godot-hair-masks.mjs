// Apply the original per-triangle hair mask BEFORE Godot reorders index buffers.
// Preserve all vertex attributes, skin weights, morph targets and animations.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const masks = JSON.parse(await readFile('godot/game/animation/avatar-hair-masks.json', 'utf8'));
const report = [];
for (const [relative, mask] of Object.entries(masks)) {
  const document = await io.read(path.join('public/models/market', relative));
  const primitives = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives()).filter(primitive => primitive.getIndices()?.getCount() === mask.triangles * 3);
  if (primitives.length !== 1) throw new Error(`Stale or ambiguous original hair mask: ${relative}`);
  const primitive = primitives[0];
  const indices = primitive.getIndices();
  const original = indices.getArray();
  const removed = new Set(mask.runs.flatMap(([start, count]) => Array.from({ length: count }, (_, index) => start + index)));
  const filtered = [];
  for (let triangle = 0; triangle < mask.triangles; triangle++) if (!removed.has(triangle)) filtered.push(...original.subarray(triangle * 3, triangle * 3 + 3));
  if (filtered.length !== (mask.triangles - removed.size) * 3) throw new Error(`Incorrect mask: ${relative}`);
  indices.setArray(new original.constructor(filtered));
  await document.transform(dequantize());
  for (const extension of document.getRoot().listExtensionsUsed()) if (['EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(extension.extensionName)) extension.dispose();
  const output = path.join('godot/assets/models/market', relative.replace('.glb', '_bald.glb'));
  await mkdir(path.dirname(output), { recursive: true });
  await io.write(output, document);
  report.push({ source: relative, output, originalTriangles: mask.triangles, removedTriangles: removed.size, retainedTriangles: filtered.length / 3 });
}
await writeFile('godot/assets/models/market/hair-mask-report.json', JSON.stringify(report, null, 2));
console.log(`${report.length} original masks baked before native import`);
