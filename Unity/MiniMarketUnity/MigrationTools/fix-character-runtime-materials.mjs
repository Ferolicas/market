import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const unity = resolve(here, '..');
const streaming = resolve(unity, 'Assets/StreamingAssets');
const catalogPath = resolve(streaming, 'Data/runtime-asset-catalog.json');
const manifestPath = resolve(unity, 'ASSET_SHA256SUMS.txt');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function resizeTexture(texture, maximum) {
  const image = texture.getImage();
  if (!image) return;
  const mime = texture.getMimeType() || 'image/png';
  const pipeline = sharp(image).resize({ width: maximum, height: maximum, fit: 'inside', withoutEnlargement: true });
  texture.setImage(mime === 'image/jpeg' ? await pipeline.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer() : await pipeline.png({ compressionLevel: 9 }).toBuffer());
  texture.setMimeType(mime);
}

const characterEntries = catalog.entries.filter(entry => entry.kind === 'character');
for (const entry of characterEntries) {
  const character = entry.id.split(':')[0];
  const maximum = character.startsWith('Customer') ? 1024 : 2048;
  const target = resolve(streaming, entry.path);
  const baseColorPath = resolve(streaming, `Art/Characters/${character}/Textures/${character}_BaseColor.jpg`);
  const document = await io.read(target);
  const baseImage = await sharp(await readFile(baseColorPath))
    .resize({ width: maximum, height: maximum, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const baseColor = document.createTexture(`${character}_BaseColor_Runtime`).setImage(baseImage).setMimeType('image/jpeg');

  for (const material of document.getRoot().listMaterials()) {
    material.setBaseColorTexture(baseColor);
    material.setBaseColorFactor([1, 1, 1, 1]);
    material.setMetallicFactor(0);
    material.setRoughnessFactor(0.68);
    material.setMetallicRoughnessTexture(null);
    material.setNormalScale(0.5);
    const specular = material.getExtension('KHR_materials_specular');
    if (specular) {
      specular.setSpecularFactor(0.24);
      specular.setSpecularColorFactor([0.8, 0.8, 0.8]);
    }
    const clearcoat = material.getExtension('KHR_materials_clearcoat');
    if (clearcoat) {
      clearcoat.setClearcoatFactor(0.08);
      clearcoat.setClearcoatRoughnessFactor(0.72);
    }
    const sheen = material.getExtension('KHR_materials_sheen');
    if (sheen) sheen.setSheenRoughnessFactor(0.78);
  }

  for (const texture of document.getRoot().listTextures()) await resizeTexture(texture, maximum);
  await document.transform(prune());
  await io.write(target, document);
  const bytes = await readFile(target);
  entry.bytes = bytes.byteLength;
  entry.sha256 = digest(bytes);
}

catalog.totalBytes = catalog.entries.reduce((total, entry) => total + entry.bytes, 0);
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
await writeFile(manifestPath, catalog.entries
  .slice().sort((a, b) => a.path.localeCompare(b.path))
  .map(entry => `${entry.sha256}  Assets/StreamingAssets/${entry.path}\n`).join(''), 'utf8');
console.log(JSON.stringify({ characters: characterEntries.length, totalBytes: catalog.totalBytes, manifest: manifestPath }, null, 2));
