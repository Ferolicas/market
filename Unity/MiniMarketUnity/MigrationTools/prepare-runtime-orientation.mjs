import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

// Tripo mosaic objects are authored at an isometric yaw. Runtime placement
// expects the physical width on local X; fitting an angled scan non-uniformly
// creates the apparent melted/sheared furniture. Correct only the root yaw in
// Unity copies, preserving every vertex, triangle, UV and texture.
const here = dirname(fileURLToPath(import.meta.url));
const unity = resolve(here, '..');
const streaming = resolve(unity, 'Assets/StreamingAssets');
const catalogPath = resolve(streaming, 'Data/runtime-asset-catalog.json');
const manifestPath = resolve(unity, 'ASSET_SHA256SUMS.txt');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const ids = new Set([
  'StorefrontWindow','AutomaticDoor','WallStraight','GlassPartition',
  'FarmFenceLong','FarmFenceShort','FarmFenceCorner','FarmGate',
  'DisplayBakery','ShelfWallTall','EggDisplay','DisplayProduceMixed','DisplayRefrigeratedDoors','ShelfWallWide',
  'CheckoutArea','OperationsWall','BackroomStorage','StockroomRack','SeasonalDisplay','ShelfEndcap','ReturnsStation','CartBay',
  'FlourMillAlt','BreadOven','CheeseMachine','JuiceMachineAlt','SupplierTerminal','DeliveryDock',
]);

function dominantYaw(node) {
  const arrays = node.getMesh()?.listPrimitives().map(primitive => primitive.getAttribute('POSITION')?.getArray()).filter(Boolean) ?? [];
  let count = 0;
  let meanX = 0;
  let meanZ = 0;
  for (const position of arrays) for (let offset = 0; offset < position.length; offset += 3) {
    meanX += position[offset];
    meanZ += position[offset + 2];
    count++;
  }
  if (!count) return null;
  meanX /= count;
  meanZ /= count;
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (const position of arrays) for (let offset = 0; offset < position.length; offset += 3) {
    const x = position[offset] - meanX;
    const z = position[offset + 2] - meanZ;
    xx += x * x;
    zz += z * z;
    xz += x * z;
  }
  return 0.5 * Math.atan2(2 * xz, xx - zz);
}

let processed = 0;
for (const entry of catalog.entries) {
  if (!ids.has(entry.id)) continue;
  const path = resolve(streaming, entry.path);
  const document = await io.read(path);
  const angles = [];
  for (const node of document.getRoot().listNodes()) {
    const angle = dominantYaw(node);
    if (angle === null) continue;
    node.setRotation([0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]);
    angles.push((angle * 180 / Math.PI).toFixed(2));
  }
  await io.write(path, document);
  const bytes = await readFile(path);
  entry.bytes = bytes.byteLength;
  entry.sha256 = createHash('sha256').update(bytes).digest('hex');
  processed++;
  console.log(`${entry.id}: yaw ${angles.join(', ')} degrees`);
}

catalog.totalBytes = catalog.entries.reduce((total, entry) => total + entry.bytes, 0);
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
await writeFile(manifestPath, catalog.entries.slice().sort((a, b) => a.path.localeCompare(b.path)).map(entry => `${entry.sha256}  Assets/StreamingAssets/${entry.path}\n`).join(''), 'utf8');
console.log(`Runtime orientation corrected: ${processed} GLBs`);
