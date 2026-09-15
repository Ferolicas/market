import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds, transformMesh, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import validator from 'gltf-validator';

// Delivered meshes face +X. Minimal species-specific rigs, not humanoid
// retargets. Keep source topology/UVs and author metre-scale, in-place clips.
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const smooth = (a,b,x) => { const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
const report=[];
for (const [kind,source,height] of [['chicken','gallina',.72],['cow','vaca',1.15]]) {
  const bytes=await readFile(`/home/ferney_oliveros/Descargas/${source}.glb`);
  const doc=await io.readBinary(bytes), root=doc.getRoot(), scene=root.listScenes()[0], buffer=root.listBuffers()[0];
  const bounds=getBounds(scene), scale=height/(bounds.max[1]-bounds.min[1]);
  for(const mesh of root.listMeshes())transformMesh(mesh,[scale,0,0,0,0,scale,0,0,0,0,scale,0,0,-bounds.min[1]*scale,0,1]);
  const cow=kind==='cow';
  const coords=cow?[[0,0,0],[.10,.62,0],[.39,.78,0],[.30,.38,.18],[.30,.38,-.18],[-.38,.38,.18],[-.38,.38,-.18],[-.48,.7,0]]:[[0,0,0],[.04,.43,0],[.28,.78,0],[.02,.24,.105],[.02,.24,-.105],[-.28,.52,0]];
  const names=cow?['Root','Neck','Head','FrontLeft','FrontRight','BackLeft','BackRight','Tail']:['Root','Neck','Head','LeftLeg','RightLeg','Tail'];
  const parents=names.map((_,i)=>i===0?-1:i===2?1:0);
  const joints=coords.map((p,i)=>doc.createNode(names[i]).setTranslation(p.map((v,k)=>(v-(parents[i]<0?0:coords[parents[i]][k]))*height)));
  joints.forEach((node,i)=>parents[i]<0?scene.addChild(node):joints[parents[i]].addChild(node));
  const inverse=coords.flatMap(p=>[1,0,0,0,0,1,0,0,0,0,1,0,...p.map(v=>-v*height),1]);
  const skin=doc.createSkin(`${kind}-rig`).setSkeleton(joints[0]).setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(new Float32Array(inverse)).setBuffer(buffer));
  joints.forEach(j=>skin.addJoint(j));
  for(const node of root.listNodes()) {
    if(!node.getMesh())continue;
    node.setSkin(skin);
    for(const p of node.getMesh().listPrimitives()) {
      const position=p.getAttribute('POSITION'), ids=new Uint16Array(position.getCount()*4), weights=new Float32Array(position.getCount()*4);
      for(let i=0;i<position.getCount();i++) {
        const [x,y,z]=position.getElement(i,[]).map(v=>v/height);
        let bone=0, weight=0;
        if(cow) {
          const leg=(1-smooth(.32,.52,y))*smooth(.04,.13,Math.abs(z));
          const head=Math.max(smooth(.10,.30,x)*smooth(.48,.63,y),smooth(.70,.78,y)*smooth(-.08,.02,x));
          const tail=(1-smooth(-.51,-.42,x))*smooth(.20,.39,y);
          if(leg>.01){bone=x>0?(z>0?3:4):(z>0?5:6);weight=leg;}
          else if(head>.01){bone=1;weight=head;}
          else if(tail>.01){bone=7;weight=tail;}
        } else {
          const leg=1-smooth(.18,.32,y);
          const neck=smooth(.02,.24,x)*smooth(.42,.59,y);
          const tail=(1-smooth(-.31,-.18,x))*smooth(.43,.66,y);
          if(leg>.01){bone=z>0?3:4;weight=leg;}
          else if(neck>.01){bone=1;weight=neck;}
          else if(tail>.01){bone=5;weight=tail;}
        }
        // The delivered head is a rigid facial mass. Keep muzzle, eyes, ears
        // and horns on the same joint; height-only blending stretches faces.
        const headMix=0;
        ids.set([bone,0,2,0],i*4);weights.set([weight*(1-headMix),1-weight,weight*headMix,0],i*4);
      }
      p.setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(ids).setBuffer(buffer));
      p.setAttribute('WEIGHTS_0',doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
    }
  }
  function track(animation,bone,path,times,values,type) {
    const sampler=doc.createAnimationSampler().setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer)).setOutput(doc.createAccessor().setType(type).setArray(new Float32Array(values.flat())).setBuffer(buffer)).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(joints[bone]).setTargetPath(path).setSampler(sampler));
  }
  function rotations(animation,bone,times,angles,axis='z') {track(animation,bone,'rotation',times,angles.map(a=>axis==='z'?[0,0,Math.sin(a/2),Math.cos(a/2)]:[Math.sin(a/2),0,0,Math.cos(a/2)]),'VEC4');}
  const idle=doc.createAnimation('Idle');rotations(idle,names.length-1,[0,1,2,3,4],[0,.045,0,-.045,0],'x');
  const walk=doc.createAnimation('Walk'),duration=cow?1.3:.8,stride=cow?.075:.055,lift=cow?.045:.038;
  const times=Array.from({length:33},(_,i)=>duration*i/32);
  for(let bone=3;bone<(cow?7:5);bone++) {
    const phase=cow?[0,.5,.75,.25][bone-3]:[0,.5][bone-3];
    const p=joints[bone].getTranslation();
    track(walk,bone,'translation',times,times.map(t=>{const f=(t/duration+phase)%1;const x=f<.5?stride*(1-4*f):stride*(-1+4*(f-.5));return[p[0]+x,p[1]+(f<.5?0:Math.sin((f-.5)*2*Math.PI)*lift),p[2]];}),'VEC3');
  }
  rotations(walk,1,[0,duration/4,duration/2,duration*3/4,duration],[0,.025,0,-.025,0]);
  const feed=doc.createAnimation(cow?'Graze':'Peck');
  const feedTimes=cow?[0,.5,1.2,1.5,1.8,2.1,2.4,2.7,3,3.6,4.2]:[0,.4,.9,1.15,1.4,1.65,1.9,2.15,2.4,3,3.5];
  rotations(feed,1,feedTimes,cow?[0,-.1,-1.27,-1.34,-1.28,-1.34,-1.28,-1.34,-1.27,-.1,0]:[0,-.1,-1.32,-1.48,-1.32,-1.48,-1.32,-1.48,-1.32,-.1,0]);
  rotations(feed,2,feedTimes,cow?[0,0,-.20,-.25,-.20,-.25,-.20,-.25,-.20,0,0]:[0,0,-.3,-.45,-.3,-.45,-.3,-.45,-.3,0,0]);
  await doc.transform(textureCompress({encoder:sharp,targetFormat:'webp',resize:[1024,1024],quality:90}),meshopt({encoder:MeshoptEncoder,level:'medium'}));
  const output=`public/models/market/delivered/${kind}.glb`;await io.write(output,doc);
  const result=await readFile(output),validation=await validator.validateBytes(result,{maxIssues:30});
  if(validation.issues.numErrors)throw new Error(JSON.stringify(validation.issues));
  report.push({kind,source:`${source}.glb`,sourceSha256:createHash('sha256').update(bytes).digest('hex'),bytes:result.length,height,bones:names,clips:['Idle','Walk',cow?'Graze':'Peck'],validatorErrors:0});
}
await writeFile('docs/delivered-animals-manifest.json',JSON.stringify(report,null,2)+'\n');console.log(report);
