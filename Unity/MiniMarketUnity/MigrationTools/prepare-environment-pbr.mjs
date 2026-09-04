import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

// Runtime-only PBR repair. Mosaic extraction previously assigned metallic
// 0.58 to an entire object whenever any part could be metal. That turned
// paint, cloth, rubber, glass surrounds and wood into chrome. This derives a
// conservative metallic/roughness map from the exact approved colour texture.
const here = dirname(fileURLToPath(import.meta.url));
const unity = resolve(here, '..');
const streaming = resolve(unity, 'Assets/StreamingAssets');
const catalogPath = resolve(streaming, 'Data/runtime-asset-catalog.json');
const manifestPath = resolve(unity, 'ASSET_SHA256SUMS.txt');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const metalCapable = new Set([
  'WateringCan','Sprinkler','ShoppingCart','CardTerminal','ReceiptPrinter','Conveyor',
  'BreadOven','UtilitySink','RefrigeratedDisplay','ChestFreezer','StockroomRack','Pallet',
  'WallClock','CeilingLight','SecurityCamera','DisplayRefrigeratedDoors','CartBay',
  'BackroomStorage','SupplierTerminal','FarmWaterTank','GlassPartition','CashierStool','StreetLight',
  'CashDrawer','CheeseMachine','DeliveryDock','FlourMill','JuiceMachine','CheckoutScanner',
  'MilkCan','CheckoutArea','CashDrawerAlt','DeliveryDockAlt','FlourMillAlt','JuiceMachineAlt',
  'CheckoutScannerAlt','AutomaticDoor','StorefrontWindow','OperationsWall','StoreEntrance','StoreEntranceAlt',
]);

// Brushed steel rather than mirror chrome: 0.42 / 0.62 in glTF's B/G channels.
const METAL_METALLIC = 107;
const METAL_ROUGHNESS = 158;

/** Drops a metallic-roughness map that nothing references any more. */
function discard(texture, baseTexture) {
  if (!texture || texture === baseTexture) return;
  if (texture.listParents().every((parent) => parent.propertyType === 'Root')) texture.dispose();
}

let processed = 0;
for (const entry of catalog.entries) {
  if (entry.kind !== 'environment' || !entry.path.toLowerCase().endsWith('.glb')) continue;
  const path = resolve(streaming, entry.path);
  const document = await io.read(path);
  let changed = false;
  for (const material of document.getRoot().listMaterials()) {
    if (material.getName().endsWith('_Glass')) continue;
    const baseTexture = material.getBaseColorTexture();
    const canBeMetal = metalCapable.has(entry.id);
    // This script runs in place over the runtime GLBs, so a re-run has to
    // release the map the previous run attached or every pass leaves another
    // orphaned texture inside the file.
    const stale = material.getMetallicRoughnessTexture();
    material.setDoubleSided(false);
    if (!canBeMetal || !baseTexture?.getImage()) {
      material.setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(0.7);
      discard(stale, baseTexture);
      changed = true;
      continue;
    }

    const decoded = await sharp(baseTexture.getImage()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const map = Buffer.alloc(decoded.info.width * decoded.info.height * 4);
    for (let source = 0, target = 0; source < decoded.data.length; source += decoded.info.channels, target += 4) {
      const red = decoded.data[source];
      const green = decoded.data[source + 1];
      const blue = decoded.data[source + 2];
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      // Real metal in this kit is a desaturated mid grey. The previous bands
      // also swept up cream plastic, white laminate and dark rubber, which is
      // why carts, fridges and shelving still read as chrome.
      const metallic = maximum - minimum <= 14 && luminance >= 58 && luminance <= 205;
      map[target] = 255;
      map[target + 1] = metallic ? METAL_ROUGHNESS : 181;
      map[target + 2] = metallic ? METAL_METALLIC : 0;
      map[target + 3] = 255;
    }
    const encoded = await sharp(map, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } })
      .png({ compressionLevel: 9 }).toBuffer();
    const pbrTexture = document.createTexture(`${entry.id}_MetallicRoughness`).setImage(encoded).setMimeType('image/png');
    material.setMetallicRoughnessTexture(pbrTexture).setMetallicFactor(1).setRoughnessFactor(1);
    const sourceInfo = material.getBaseColorTextureInfo();
    const targetInfo = material.getMetallicRoughnessTextureInfo();
    if (sourceInfo && targetInfo) targetInfo.setTexCoord(sourceInfo.getTexCoord());
    discard(stale, baseTexture);
    changed = true;
  }
  if (!changed) continue;
  await io.write(path, document);
  const bytes = await readFile(path);
  entry.bytes = bytes.byteLength;
  entry.sha256 = createHash('sha256').update(bytes).digest('hex');
  processed++;
}

catalog.totalBytes = catalog.entries.reduce((total, entry) => total + entry.bytes, 0);
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
await writeFile(manifestPath, catalog.entries.slice().sort((a, b) => a.path.localeCompare(b.path)).map(entry => `${entry.sha256}  Assets/StreamingAssets/${entry.path}\n`).join(''), 'utf8');
console.log(`Environment PBR repaired: ${processed} runtime GLBs`);
