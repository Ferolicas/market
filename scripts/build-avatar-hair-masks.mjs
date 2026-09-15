import { writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import sharp from 'sharp';

// Face-index masks leave every original position, UV, skin weight and morph
// intact. Hoods continue to render the original unmasked geometry.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const masks = {};
for (const body of ['man','woman','boy','girl']) for (const tier of ['', 'lod1/', 'lod2/']) {
  const path = `characters/${tier}owner_${body}.glb`;
  const document = await io.read(`public/models/market/${path}`);
  await document.transform(dequantize());
  const node = document.getRoot().listNodes().find(n => n.getSkin() && n.getMesh());
  const skin = node.getSkin(), joints = skin.listJoints(), inverse = skin.getInverseBindMatrices();
  const matrices = joints.map((joint,i) => new THREE.Matrix4().fromArray(joint.getWorldMatrix()).multiply(new THREE.Matrix4().fromArray(inverse.getElement(i,[]))));
  const headJoint = joints.findIndex(j => j.getName() === 'Head');
  const head = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(joints[headJoint].getWorldMatrix()));
  const primitive = node.getMesh().listPrimitives()[0];
  const texture = primitive.getMaterial().getBaseColorTexture();
  const {data,info} = await sharp(texture.getImage()).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const positions = primitive.getAttribute('POSITION'), uvs = primitive.getAttribute('TEXCOORD_0'), weights = primitive.getAttribute('WEIGHTS_0'), ids = primitive.getAttribute('JOINTS_0');
  const indices = primitive.getIndices().getArray();
  const vertices=[];
  for(let i=0;i<positions.getCount();i++) {
    const p=positions.getElement(i,[]),w=weights.getElement(i,[]),j=ids.getElement(i,[]),world=new THREE.Vector3();
    let headWeight=0;
    for(let k=0;k<4;k++){world.add(new THREE.Vector3(...p).applyMatrix4(matrices[j[k]]).multiplyScalar(w[k]));if(j[k]===headJoint)headWeight+=w[k];}
    const uv=uvs.getElement(i,[]),x=Math.min(info.width-1,Math.max(0,Math.floor(uv[0]*info.width))),y=Math.min(info.height-1,Math.max(0,Math.floor(uv[1]*info.height))),off=(y*info.width+x)*info.channels;
    vertices.push({p:world,w:headWeight,r:data[off]/255,g:data[off+1]/255,b:data[off+2]/255});
  }
  const top=Math.max(...vertices.filter(v=>v.w>.5).map(v=>v.p.y));
  const removed=[];
  for(let face=0;face<indices.length/3;face++) {
    const vs=[0,1,2].map(k=>vertices[indices[face*3+k]]);
    const c=vs.reduce((p,v)=>p.add(v.p),new THREE.Vector3()).multiplyScalar(1/3);
    if(vs.reduce((n,v)=>n+v.w,0)/3<.5 || c.y<head.y-.025)continue;
    const front=c.z>head.z+.055;
    // Eyes, brows, nose and ears remain protected. The side ponytails extend
    // outside the skull and are removed with the same texture classification.
    const centralFace=front && Math.abs(c.x-head.x)<(body==='boy'||body==='girl'?.09:.067) && c.y<top-.075;
    if(centralFace)continue;
    const dark=vs.filter(v=>Math.max(v.r,v.g,v.b)<.55 && (v.r+v.g+v.b)/3<.37).length>=2;
    const crown=c.y>top-.04;
    const originalBow=body==='girl' && c.y>head.y+.09 && vs.filter(v=>v.r>v.g*1.4&&v.r>v.b*1.3).length>=2;
    if(dark||crown||originalBow)removed.push(face);
  }
  const runs=[];
  for(const face of removed){const previous=runs.at(-1);if(previous&&previous[0]+previous[1]===face)previous[1]++;else runs.push([face,1]);}
  if(!removed.length || removed.length>indices.length/3*.3)throw new Error(`Invalid hair mask ${path}`);
  masks[path]={triangles:indices.length/3,runs};
  console.log(path,{removed:removed.length,total:indices.length/3});
}
await writeFile('src/game/animation/avatar-hair-masks.json',JSON.stringify(masks)+'\n');
