// Offline authoring only: assemble the actual React components, then export
// their geometry/materials. Gameplay in the Godot build remains native.
import {Suspense, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas, useThree} from '@react-three/fiber';
import {Physics} from '@react-three/rapier';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import * as THREE from 'three';
import {MarketScene, GodotRearDoorAssembly, GodotMarketGround, GodotMarketBuilding, godotInteractionZones} from '../../src/components/game/MarketScene';
import {KitFurniture, KitFarm, GodotCheckoutBag, GodotRetailProduct, GodotRetailProductBatch, GodotCropPlot, GodotDormantCropPlot, GodotClosedCheckoutKit} from '../../src/components/game/MarketKit';
import {HarvestBasket, BasketProduct} from '../../src/components/game/HarvestBasket';
import {GodotCustomerCart, GodotCustomerBag} from '../../src/components/game/Customer';
import {GodotThumbnailEnvironment} from '../../src/components/game/AvatarThumbnails';
import {AvatarCustomizer, GodotStudioEnvironment} from '../../src/components/game/AvatarCustomizer';
import {CityPerimeter} from '../../src/components/game/CityPerimeter';
import {AuthScreen} from '../../src/components/auth/AuthScreen';
import {createInitialGame, createCampaignGame, normalizeGameState} from '../../src/game/engine';
import {FARM_PLOTS} from '../../src/game/stations/farm-layout';
import {OPENING_PURCHASES} from '../../src/game/progression/MartCampaign';
import {ALL_PURCHASED_AREAS} from '../../src/game/stations/fixture-availability';
import {createMachine} from '../../src/game/stations/StationSystem';
import {CHECKOUT_LANES} from '../../src/game/stations/checkout-layout';
import {STORE_LAYOUT_SCALE, scaleStorePosition} from '../../src/game/world-scale';
const state = createInitialGame(); state.level = 30;
const store = normalizeGameState(state).franchises[0];
// Art library includes every authored fixture, independent of player progress.
store.unlockedAreas = [...ALL_PURCHASED_AREAS];
store.productionMachines.push(createMachine("chicken-coop-2","eggs"),createMachine("corn-canner-1","cannedCorn"));
for (const id of Object.keys(store.shelves)) store.shelves[id] = 0;
const mode = new URLSearchParams(location.search).get('part') ?? 'ground';
function Capture() {
 const {scene,gl} = useThree();
 useEffect(()=> { window.exportMarket = async () => {
  scene.updateMatrixWorld(true);
  const source = scene.getObjectByName('authored');
  if (!source || !source.children.length) throw Error('Source scene has not loaded');
  const labels = []; const manifest = []; const externalModels=[]; let meshes = 0;
  const exported = new THREE.Group(); exported.name = 'authored';
  // Copy only visible source geometry. SDF text needs a native Label3D;
  // its complete authored transform and contents are exported separately.
  function copy(node, parent, route) {
   if (!node.visible) return;
   const name = `n${manifest.length}`;
   manifest.push({name, sourceName:node.name, authored:node.userData.authoredPosition?node.userData:null, castShadow:node.castShadow??false, receiveShadow:node.receiveShadow??false, light:node.isPointLight?{intensity:node.intensity,color:node.color.getHexString(),distance:node.distance,decay:node.decay}:null, materials:node.material?(Array.isArray(node.material)?node.material:[node.material]).map(material=>({transparent:material.transparent,opacity:material.opacity,transmission:material.transmission??0,clearcoat:material.clearcoat??0,clearcoatRoughness:material.clearcoatRoughness??0,depthWrite:material.depthWrite,unshaded:material.isMeshBasicMaterial??false,toneMapped:material.toneMapped,fog:material.fog})):null, route, matrix:node.matrix.toArray()});
   if (['dynamic:delivered-cow','dynamic:delivered-chicken'].includes(node.name)) {
    const kind=node.name.split('-').at(-1);
    const anchor=new THREE.Group();anchor.name=name;
    // The original actor starts here before its animation clock advances.
    anchor.position.set(0,0.08,0.32);parent.add(anchor);
    externalModels.push({name,kind,path:`res://assets/models/market/delivered/${kind}.glb`});return;
   }
   if (typeof node.text === 'string' && typeof node.fontSize === 'number') {
    labels.push({name, parent:parent.name, text:node.text, fontSize:node.fontSize, color:new THREE.Color(node.color).getHexString(), anchorX:node.anchorX, anchorY:node.anchorY, matrix:node.matrix.toArray()});
    return;
   }
   let clone;
   if (node.isInstancedMesh) {
    clone = new THREE.Group();
    for(let i=0;i<node.count;i++){
      const instance=new THREE.Mesh(node.geometry,node.material);
      instance.name=`${name}_instance_${i}`;
      node.getMatrixAt(i,instance.matrix);
      instance.matrix.decompose(instance.position,instance.quaternion,instance.scale);
      if(node.instanceColor){instance.material=instance.material.clone();node.getColorAt(i,instance.material.color);}
      clone.add(instance);meshes++;
    }
   } else if (node.isMesh) {
    if (node.isSkinnedMesh) throw Error('Animated skin must be exported from original model');
    clone = node.clone(false); meshes++;
    // Preserve the source product icons rendered once into GPU textures.
    const materials=(Array.isArray(clone.material)?clone.material:[clone.material]).map(material=>{
      if (!material.map?.isRenderTargetTexture) return material;
      const texture=material.map, context=gl.getContext();
      const width=texture.image.width,height=texture.image.height;
      const pixels=new Uint8Array(width*height*4),framebuffer=context.createFramebuffer();
      context.bindFramebuffer(context.FRAMEBUFFER,framebuffer);
      context.framebufferTexture2D(context.FRAMEBUFFER,context.COLOR_ATTACHMENT0,context.TEXTURE_2D,gl.properties.get(texture).__webglTexture,0);
      if(context.checkFramebufferStatus(context.FRAMEBUFFER)!==context.FRAMEBUFFER_COMPLETE)throw Error('Icon texture framebuffer incomplete');
      context.readPixels(0,0,width,height,context.RGBA,context.UNSIGNED_BYTE,pixels);
      context.bindFramebuffer(context.FRAMEBUFFER,null);context.deleteFramebuffer(framebuffer);gl.resetState();
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const image=canvas.getContext('2d').createImageData(width,height);
      for(let y=0;y<height;y++)image.data.set(pixels.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);
      canvas.getContext('2d').putImageData(image,0,0);
      const result=material.clone();result.map=new THREE.CanvasTexture(canvas);result.map.colorSpace=texture.colorSpace;
      return result;
    });
    clone.material=Array.isArray(clone.material)?materials:materials[0];
   } else if (node.isLight) { clone=node.clone(false); }
   else clone=new THREE.Group();
   clone.name=name; clone.userData={sourceName:node.name};
   clone.matrix.copy(node.matrix); clone.matrix.decompose(clone.position,clone.quaternion,clone.scale);
   parent.add(clone);
   for (let i=0;i<node.children.length;i++)copy(node.children[i],clone,[...route,i]);
  }
  copy(source,exported,[]);
  if (!meshes) throw Error('No authored meshes were exported');
  const glb=await new GLTFExporter().parseAsync(exported,{binary:true,onlyVisible:true});
  await fetch(`/export/${mode}.glb`,{method:'PUT',body:glb});
  await fetch(`/export/${mode}.json`,{method:'PUT',body:JSON.stringify({source:'src/components/game',part:mode,meshes,manifest,labels,externalModels,...mode==='ground'?{zones:godotInteractionZones(1,ALL_PURCHASED_AREAS,FARM_PLOTS.map(plot=>plot.id),OPENING_PURCHASES.map(purchase=>purchase.id))}:{}},null,2)});
  return {meshes,labels:labels.length,nodes:manifest.length};
 }; },[scene,gl]);
 return null;
}
const cropNames = {tomato:'TOMATES',orange:'NARANJAS',apple:'MANZANAS',wheat:'TRIGO',corn:'MAÍZ',coffee:'CAFÉ'};
const parts = {
 'closed-checkouts':<group>{[1,2].map(lane=><group key={lane} name={`closed-checkout:${lane}`} position={scaleStorePosition(CHECKOUT_LANES[lane].counter)}><GodotClosedCheckoutKit lane={lane}/></group>)}</group>,
 'customer-bag':<GodotCustomerBag/>,
 'customer-cart':<GodotCustomerCart inventory={{}} bagged={true} compact={false}/>,
 'rear-door':<Physics><GodotRearDoorAssembly playerFocus={{current:new THREE.Vector3()}}/></Physics>,
 basket:<HarvestBasket carry={{capacity:3,items:{tomatoes:1}}}/>,
 'checkout-bag':<GodotCheckoutBag fill={1}/>,
 'retail-products':<group>{Object.keys(store.shelves).map(productId=><group key={productId} name={`retail-template:${productId}`}><GodotRetailProduct productId={productId} position={[0,0,0]}/></group>)}</group>,
 'carry-products':<group>{Object.keys(store.shelves).map(productId=><group key={productId} name={`carry-product:${productId}`}><BasketProduct productId={productId}/></group>)}</group>,
 crops:<group>{Object.keys(cropNames).flatMap(crop=>['EMPTY',0,1,2,3,'READY'].map(stage=><group key={`${crop}-${stage}`} name={`crop:${crop}:${stage}`}><GodotCropPlot position={[0,0,0]} crop={crop} status={typeof stage==='number'?'GROWING':stage} progress={typeof stage==='number'?stage/4:stage==='READY'?1:0} available={100} yieldCapacity={100} accent="#ffffff" label={cropNames[crop]}/></group>))}<group name="crop:LOCKED"><GodotDormantCropPlot/></group></group>,
 ground:<group scale={[STORE_LAYOUT_SCALE,1,STORE_LAYOUT_SCALE]}><GodotMarketGround/></group>,
 city:<group scale={[STORE_LAYOUT_SCALE,1,STORE_LAYOUT_SCALE]}><CityPerimeter/></group>,
 building:<group scale={[STORE_LAYOUT_SCALE,1,STORE_LAYOUT_SCALE]}><GodotMarketBuilding open={false} doorMotion={{current:{progress:0}}}/></group>,
 furniture:<KitFurniture shelves={store.shelves} shelfTier={store.shelvesLevel} machines={store.productionMachines} customers={[]} checkoutTransactions={[]} returnsBin={store.returnsBin} returnedCartCount={4} lightsOn={false} dynamicCeilingLights={false} unlockedAreas={store.unlockedAreas}/>,
 farm:<KitFarm crops={store.crops} machines={store.productionMachines} nowMs={0} unlockedAreas={store.unlockedAreas}/>,
};
const root=createRoot(document.getElementById('root'));
if(mode==='auth-art'){
 root.render(<AuthScreen/>);
}else if(mode==='preview-reference'){
 root.render(<AvatarCustomizer avatar={createCampaignGame().avatar} onChange={()=>{}}/>);
 const ready=setInterval(()=>{const state=window.__marketReferenceState;if(state?.scene.environment?.isCubeTexture&&state.scene.getObjectByProperty('isSkinnedMesh',true)){window.sourceSceneReady=true;clearInterval(ready);}},50);
}else if(mode==='reference'){
 const response=await fetch('/reference-state.json');const game=(response.ok?await response.json():null)??createCampaignGame();const f=game.franchises.find(f=>f.id===game.currentFranchiseId);
 root.render(<MarketScene avatar={game.avatar} carry={f.carry} visualCarry={f.carry} checkoutLevel={f.checkoutLevel} playerSpeedTier={f.playerSpeedTier} customers={f.customers} checkoutTransactions={f.checkoutTransactions} registerCashMinor={f.registerCashMinor} cashBundleMinor={100} purchaseMarkers={[]} returnsBin={f.returnsBin} returnedCartCount={f.returnedCartCount} crops={f.crops} visualCrops={f.crops} productionMachines={f.productionMachines} shelves={f.shelves} visualShelves={f.shelves} shelfTier={f.shelvesLevel} unlockedAreas={f.unlockedAreas} lightsOn={f.lightsOn} minuteOfDay={game.minuteOfDay} simulationTimeMs={game.simulationTimeMs} employees={f.employees} lastInteraction={null} transferEvents={[]} onTransferProgress={()=>{}} onInteract={()=>{}} onDistance={()=>{}} open={f.open} doorState={f.doorState} doorProgress={f.doorProgress} onDoorPresence={()=>{}} onSceneReady={()=>window.sourceSceneReady=true}/>);
}else if((mode==='preview-lighting'||mode==='thumbnail-lighting')) root.render(<Canvas onCreated={state=>{window.__marketReferenceState=state;}}><Suspense fallback={null}>{mode==='preview-lighting'?<GodotStudioEnvironment/>:<GodotThumbnailEnvironment/>}</Suspense></Canvas>);
else root.render(<Canvas><ambientLight intensity={1}/><Suspense fallback={null}><group name="authored">{mode.startsWith('product-')?<GodotRetailProductBatch productId={mode.slice(8)} transforms={[{position:[0,0,0]}]} capacity={1}/>:parts[mode]}</group></Suspense><Capture/></Canvas>);

// Capture the original prefiltered environment in linear half floats. This is
// authoring data, not a lighting approximation assembled in the native game.
window.exportOriginalEnvironment = () => {
  const { gl: renderer, scene } = window.__marketReferenceState;
  if (!scene.environment?.isCubeTexture) throw Error('Original cube environment is not ready');
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromCubemap(scene.environment);
  const data = new Uint16Array(target.width * target.height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data);
  if (renderer.getContext().getError() !== 0 || !data.some(value => value > 0)) throw Error('Cannot read original HDR environment');
  const result = { source: mode==='preview-lighting'?'AvatarCustomizer.tsx StudioEnvironment':'MarketScene.tsx LocalEnvironment', intensity: scene.environmentIntensity, width: target.width, height: target.height, data: Array.from(data) };
  target.dispose();
  generator.dispose();
  return result;
};

if(mode==='preview-lighting'||mode==='thumbnail-lighting'){ const ready=setInterval(()=>{if(window.__marketReferenceState?.scene.environment?.isCubeTexture){window.sourceSceneReady=true;clearInterval(ready);}},50); }

// Reference capture of Drei's actual one-frame contact atlas, including alpha.
window.exportOriginalContactShadow = () => {
  const {gl:renderer,scene}=window.__marketReferenceState;
  const root=scene.getObjectByName('perf:contact-shadows');
  let texture;
  root.traverse(node=>{if(node.isMesh&&node.material?.map)texture=node.material.map;});
  if(!texture)throw Error('Original contact-shadow texture is absent');
  const gl=renderer.getContext(),previous=gl.getParameter(gl.FRAMEBUFFER_BINDING),framebuffer=gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,renderer.properties.get(texture).__webglTexture,0);
  const width=texture.image.width,height=texture.image.height,data=new Uint8Array(width*height*4);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Original shadow attachment is incomplete');
  gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);
  gl.bindFramebuffer(gl.FRAMEBUFFER,previous);gl.deleteFramebuffer(framebuffer);
  if(gl.getError()!==0)throw Error('Original contact-shadow readback failed');
  return {width,height,data:Array.from(data)};
};
