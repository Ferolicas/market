import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const here=dirname(fileURLToPath(import.meta.url));
const unity=resolve(here,'..');
const streaming=resolve(unity,'Assets/StreamingAssets');
const catalogPath=resolve(streaming,'Data/runtime-asset-catalog.json');
const manifestPath=resolve(unity,'ASSET_SHA256SUMS.txt');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const catalog=JSON.parse(await readFile(catalogPath,'utf8'));
const characters=['AdultMale','AdultFemale','Boy','Girl','CustomerFemale01','CustomerFemale02','CustomerFemale03','CustomerFemale04','CustomerMale01'];
const carryArmBones=new Set(['Rig_Arm_L','Forearm_L','Hand_L','Rig_Arm_R','Forearm_R','Hand_R']);

function duration(animation){let value=0;for(const sampler of animation.listSamplers()){const times=sampler.getInput()?.getArray();if(times?.length)value=Math.max(value,times[times.length-1]);}return value;}
function isCarryArm(channel){return carryArmBones.has(channel.getTargetNode()?.getName()??'');}
function sampleChannel(channel,time){
  const sampler=channel.getSampler();const input=sampler?.getInput();const output=sampler?.getOutput();
  if(!input||!output)return null;
  const times=input.getArray();const values=output.getArray();const size=output.getElementSize();
  if(!times?.length||!values?.length)return null;
  let left=0;while(left<times.length-2&&times[left+1]<=time)left++;
  const right=Math.min(left+1,times.length-1);const span=times[right]-times[left];const alpha=span>0?Math.max(0,Math.min(1,(time-times[left])/span)):0;
  const result=new Float32Array(size);
  if(channel.getTargetPath()==='rotation'&&size===4){
    let ax=values[left*4],ay=values[left*4+1],az=values[left*4+2],aw=values[left*4+3];
    let bx=values[right*4],by=values[right*4+1],bz=values[right*4+2],bw=values[right*4+3];
    let cos=ax*bx+ay*by+az*bz+aw*bw;if(cos<0){cos=-cos;bx=-bx;by=-by;bz=-bz;bw=-bw;}
    let s0=1-alpha,s1=alpha;
    if(1-cos>1e-6){const angle=Math.acos(Math.max(-1,Math.min(1,cos)));const sin=Math.sin(angle);s0=Math.sin((1-alpha)*angle)/sin;s1=Math.sin(alpha*angle)/sin;}
    result[0]=ax*s0+bx*s1;result[1]=ay*s0+by*s1;result[2]=az*s0+bz*s1;result[3]=aw*s0+bw*s1;
  }else for(let i=0;i<size;i++)result[i]=values[left*size+i]+(values[right*size+i]-values[left*size+i])*alpha;
  return result;
}
function addConstantChannel(document,animation,poseChannel,clipDuration,label){
  const sampled=sampleChannel(poseChannel,.5);if(!sampled)return;
  const input=document.createAccessor(`${label}:time`).setType(Accessor.Type.SCALAR).setArray(new Float32Array([0,clipDuration]));
  const outputType=poseChannel.getSampler().getOutput().getType();
  const values=new Float32Array(sampled.length*2);values.set(sampled);values.set(sampled,sampled.length);
  const output=document.createAccessor(`${label}:pose`).setType(outputType).setArray(values);
  const sampler=document.createAnimationSampler(label).setInput(input).setOutput(output).setInterpolation('LINEAR');
  const channel=document.createAnimationChannel(label).setTargetNode(poseChannel.getTargetNode()).setTargetPath(poseChannel.getTargetPath()).setSampler(sampler);
  animation.addSampler(sampler).addChannel(channel);
}
function composeCarryAnimations(document){
  const animations=document.getRoot().listAnimations();const carryPose=animations.find(item=>item.getName()==='CarryBox');
  if(!carryPose)return;
  const poseChannels=carryPose.listChannels().filter(isCarryArm);
  for(const animation of animations.filter(item=>item.getName()==='CarryIdle'||item.getName()==='CarryWalk')){
    for(const channel of animation.listChannels().filter(isCarryArm)){
      const sampler=channel.getSampler();animation.removeChannel(channel);channel.dispose();
      if(sampler){animation.removeSampler(sampler);sampler.dispose();}
    }
    const clipDuration=duration(animation);for(const channel of poseChannels)addConstantChannel(document,animation,channel,clipDuration,`${animation.getName()}:${channel.getTargetNode().getName()}:${channel.getTargetPath()}`);
  }
  if(animations.some(item=>item.getName()==='CarryRun'))return;
  const run=animations.find(item=>item.getName()==='Run');if(!run)return;
  const carryRun=document.createAnimation('CarryRun');const clipDuration=duration(run);
  for(const sourceChannel of run.listChannels()){
    if(isCarryArm(sourceChannel))continue;
    const sourceSampler=sourceChannel.getSampler();
    const sampler=document.createAnimationSampler(`CarryRun:${sourceChannel.getTargetNode()?.getName()}:${sourceChannel.getTargetPath()}`)
      .setInput(sourceSampler.getInput()).setOutput(sourceSampler.getOutput()).setInterpolation(sourceSampler.getInterpolation());
    const channel=document.createAnimationChannel(sampler.getName()).setTargetNode(sourceChannel.getTargetNode()).setTargetPath(sourceChannel.getTargetPath()).setSampler(sampler);
    carryRun.addSampler(sampler).addChannel(channel);
  }
  for(const channel of poseChannels)addConstantChannel(document,carryRun,channel,clipDuration,`CarryRun:${channel.getTargetNode().getName()}:${channel.getTargetPath()}`);
}

for(const character of characters){
  const source=resolve(streaming,`Art/Characters/${character}/LOD0.glb`);
  const target=resolve(streaming,`Art/Characters/${character}/Motion.glb`);
  const document=await io.read(source);const root=document.getRoot();
  composeCarryAnimations(document);
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
