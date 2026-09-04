import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const here=dirname(fileURLToPath(import.meta.url));
const unity=resolve(here,'..');
const streaming=resolve(unity,'Assets/StreamingAssets');
const catalogPath=resolve(streaming,'Data/runtime-asset-catalog.json');
const manifestPath=resolve(unity,'ASSET_SHA256SUMS.txt');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const catalog=JSON.parse(await readFile(catalogPath,'utf8'));
const characters=['AdultMale','AdultFemale','Boy','Girl','CustomerFemale01','CustomerFemale02','CustomerFemale03','CustomerMale01','CustomerMale02'];

for(const character of characters){
  const source=resolve(streaming,`Art/Characters/${character}/LOD0.glb`);
  const target=resolve(streaming,`Art/Characters/${character}/Motion.glb`);
  const document=await io.read(source);const root=document.getRoot();
  for(const node of root.listNodes()){node.setMesh(null);node.setCamera(null);}
  for(const mesh of root.listMeshes())mesh.dispose();
  for(const material of root.listMaterials())material.dispose();
  for(const texture of root.listTextures())texture.dispose();
  await document.transform(prune({keepLeaves:false,keepAttributes:false}));
  await mkdir(dirname(target),{recursive:true});await io.write(target,document);
  const bytes=await readFile(target);const sha256=createHash('sha256').update(bytes).digest('hex');
  const entry={id:`${character}:Motion`,kind:'character-motion',path:`Art/Characters/${character}/Motion.glb`,source:`derived-from:${character}:LOD0`,bytes:bytes.byteLength,sha256};
  const index=catalog.entries.findIndex(item=>item.id===entry.id);if(index>=0)catalog.entries[index]=entry;else catalog.entries.push(entry);
  console.log(`${character}: ${bytes.byteLength} bytes`);
}
catalog.counts={};for(const entry of catalog.entries)catalog.counts[entry.kind]=(catalog.counts[entry.kind]||0)+1;
catalog.totalBytes=catalog.entries.reduce((total,entry)=>total+entry.bytes,0);
await writeFile(catalogPath,`${JSON.stringify(catalog,null,2)}\n`,'utf8');
await writeFile(manifestPath,catalog.entries.slice().sort((a,b)=>a.path.localeCompare(b.path)).map(entry=>`${entry.sha256}  Assets/StreamingAssets/${entry.path}\n`).join(''),'utf8');

