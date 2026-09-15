import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds, textureCompress, meshopt, transformMesh } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import validator from 'gltf-validator';
import { BoxGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Uniform scale preserves the delivered silhouette; the target is an envelope,
// not an instruction to stretch geometry. Products are centred for carry/slots.
const inputs = [
  ['mill', 'MOLINO.glb', [1.25, 1.72, 1.08], false],
  ['oven', 'HORNO.glb', [1.48, 1.72, 1.08], false],
  ['juicer', 'EXPRIMIDORA.glb', [1.16, 1.7, 1.04], false],
  ['cheese', 'NUEVO_KIT/QUESO.glb', [.16, .14, .12], true],
  ['milk', 'NUEVO_KIT/LECHE.glb', [.12, .26, .12], true],
  ['dairy', 'NUEVO_KIT/LACTEOS.glb', [2.4, 2.4, 1.1], false],
  ['egg', 'NUEVO_KIT/HUEVO.glb', [.115, .16, .115], true],
  ['egg-display', 'NUEVO_KIT/ESTANTE_HUEVOS.glb', [2.15, 2.1, 1.3], false],
];
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const output = 'public/models/market/delivered';
await mkdir(output, { recursive: true });
const report = [];
for (const [id, source, envelope, centred] of inputs) {
  const original = await readFile(`/home/ferney_oliveros/Descargas/${source}`);
  const document = await io.readBinary(original);
  const scene = document.getRoot().listScenes()[0];
  const bounds = getBounds(scene);
  const size = bounds.max.map((v, i) => v - bounds.min[i]);
  const scale = Math.min(...envelope.map((v, i) => v / size[i]));
  const center = bounds.min.map((v, i) => (v + bounds.max[i]) / 2);
  const translation = [-center[0] * scale, -(centred ? center[1] : bounds.min[1]) * scale, -center[2] * scale];
  for (const mesh of document.getRoot().listMeshes()) {
    transformMesh(mesh, [scale,0,0,0, 0,scale,0,0, 0,0,scale,0, ...translation,1]);
    mesh.setName(`delivered:${id}`);
  }
  const normalizedBounds = getBounds(scene);
  if (id === 'dairy') {
    // Preserve every source triangle, but separate the three front leaves
    // into rigid, hinged nodes. UVs/materials are shared with the cabinet.
    const node=document.getRoot().listNodes().find(n=>n.getMesh());
    const mesh=node.getMesh(),primitive=mesh.listPrimitives()[0],positions=primitive.getAttribute('POSITION'),indices=primitive.getIndices().getArray();
    const groups=[[],[],[],[]],hinges=[-1.14,-.38,.39];
    const trimMaterial=document.createMaterial('Dairy dark edge lining').setBaseColorFactor([.018,.022,.018,1]).setRoughnessFactor(.58).setDoubleSided(true);
    const framePrimitive=(boxes)=>{
      const geometry=mergeGeometries(boxes.map(([size,position])=>new BoxGeometry(...size).translate(...position)));
      const result=document.createPrimitive().setMaterial(trimMaterial),buffer=document.getRoot().listBuffers()[0];
      for(const [name,semantic,type] of [['position','POSITION','VEC3'],['normal','NORMAL','VEC3']])result.setAttribute(semantic,document.createAccessor().setType(type).setArray(new Float32Array(geometry.attributes[name].array)).setBuffer(buffer));
      result.setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array(geometry.index.array)).setBuffer(buffer));geometry.dispose();return result;
    };
    for(let i=0;i<indices.length;i+=3){
      const ids=[indices[i],indices[i+1],indices[i+2]],vertices=ids.map(index=>positions.getElement(index,[]));
      const x=vertices.reduce((n,v)=>n+v[0],0)/3;
      const isDoor=vertices.every(v=>v[2]>.35&&v[1]>.22&&v[1]<1.49);
      const group=isDoor?(x<-.4?1:x<.4?2:3):0;groups[group].push(...ids);
    }
    primitive.setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array(groups[0])).setBuffer(document.getRoot().listBuffers()[0]));
    for(let door=0;door<3;door++){
      if(groups[door+1].length<150)throw new Error(`Dairy door ${door}: insufficient geometry`);
      const leaf=primitive.clone();leaf.setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array(groups[door+1])).setBuffer(document.getRoot().listBuffers()[0]));
      const translated=new Float32Array(positions.getArray());for(let i=0;i<translated.length;i+=3){translated[i]-=hinges[door];translated[i+1]-=.22;translated[i+2]-=.43;}
      leaf.setAttribute('POSITION',positions.clone().setArray(translated));
      const doorMesh=document.createMesh(`DairyDoorMesh${door+1}`).addPrimitive(leaf);
      // Cap the cut boundary rather than leaving open, jagged backfaces when
      // the leaf rotates away from the originally fused cabinet.
      doorMesh.addPrimitive(framePrimitive([
        [[.045,1.24,.055],[0,.635,-.005]],[[.045,1.24,.055],[.735,.635,-.005]],
        [[.78,.045,.055],[.3675,.015,-.005]],[[.78,.045,.055],[.3675,1.255,-.005]],
      ]));
      scene.addChild(document.createNode(`DairyDoor${door+1}`).setMesh(doorMesh).setTranslation([hinges[door],.22,.43]));
    }
    mesh.addPrimitive(framePrimitive([
      ...[-1.15,-.4,.4,1.15].map(x=>[[.065,1.27,.10],[x,.86,.35]]),
      [[2.32,.18,.10],[0,.28,.35]],[[2.32,.055,.10],[0,1.465,.35]],
    ]));
    console.log('Dairy triangle partition',groups.map(g=>g.length/3));
  }
  await document.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024,1024], quality: 90 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const asset = `${output}/${id}.glb`;
  await io.write(asset, document);
  const bytes = await readFile(asset);
  const validation = await validator.validateBytes(bytes, { maxIssues: 20 });
  if (validation.issues.numErrors) throw new Error(`${id}: ${JSON.stringify(validation.issues)}`);
  report.push({ id, source, sourceSha256: createHash('sha256').update(original).digest('hex'), bytes: bytes.length, sourceBytes: original.length, normalizedBounds, validatorErrors: validation.issues.numErrors });
}
await writeFile('docs/delivered-assets-manifest.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
