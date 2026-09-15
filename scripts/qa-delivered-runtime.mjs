import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const output=process.argv[2]??'/tmp/market-delivered-runtime';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/ferney_oliveros/.local/bin/google-chrome',args:['--no-sandbox','--enable-gpu','--ignore-gpu-blocklist','--use-angle=vulkan','--enable-features=Vulkan']});
const page=await browser.newPage({viewport:{width:1440,height:1000},recordVideo:{dir:output,size:{width:1440,height:1000}}});
const errors=[],responses=[];
await page.addInitScript(()=>{
 window.__DELIVERED_REACT_ROOTS=[];
 window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),inject(renderer){const id=this.renderers.size+1;this.renderers.set(id,renderer);return id;},onCommitFiberRoot(_id,root){if(!window.__DELIVERED_REACT_ROOTS.includes(root))window.__DELIVERED_REACT_ROOTS.push(root);},onCommitFiberUnmount(){},onPostCommitFiberRoot(){}};
});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.url().includes('/delivered/'))responses.push({url:r.url(),status:r.status()});});
await page.goto('http://localhost:3000?debug=1');
const id=Date.now().toString(36);
await page.getByRole('button',{name:'Crear perfil nuevo'}).click();
await page.getByLabel('Tu nombre').fill('Delivered QA');await page.getByLabel('Nombre de usuario').fill(`delivered_${id}`);await page.getByLabel('Correo electrónico').fill(`delivered.${id}@example.test`);await page.getByLabel('Contraseña').fill(`Delivered-${id}-Safe!`);await page.getByRole('button',{name:'Crear perfil y jugar'}).click();
await page.getByRole('button',{name:'Abrir mi primer Mini Market'}).click({timeout:60000});
await page.waitForFunction(()=>window.__MARKET_QA__?.saveRevision,{},{timeout:60000});
await page.evaluate(()=>sessionStorage.setItem('mini-market-qa-freeze','1'));
await page.locator('.player-chip button').click();await page.waitForFunction(()=>window.__MARKET_QA__?.saveStatus==='saved',{},{timeout:30000});
await page.evaluate(()=>{
 const qa=structuredClone(window.__MARKET_QA__),s=qa.state,f=s.franchises.find(f=>f.id===s.currentFranchiseId);s.level=30;s.revision+=10000;
 f.unlockedAreas.push('flour-mill','bread-oven','juice-machine','cheese-maker','chicken-coop','cow-station','expansion-side','expansion-rear');
 f.productionMachines.forEach(m=>{m.status='PROCESSING';m.output=2;});Object.keys(f.shelves).forEach(k=>f.shelves[k]=24);
 f.customers=[{id:'qa-dairy-access',identity:1,state:'WAIT_FOR_ACCESS',shoppingList:[{productId:'milk',requested:1,picked:0}],currentLine:0,basket:{},patienceMs:10000,checkoutPatienceMs:300000,waitingSince:null,queueSlot:null,transactionId:null,hasCart:false,hasBag:false,angry:false,x:0,z:-2,targetX:0,targetZ:-2,path:[],pathIndex:0,speed:1.45,stateSince:0,reservedSocketId:'milk:0',blockedSince:null,routeFailures:0}];
 localStorage.setItem('mini-market-recovery-v1',JSON.stringify({state:s,saveRevision:qa.saveRevision,pendingEvents:[]}));
});
await page.reload();await page.waitForTimeout(8000);
// Locate the renderer through React's existing provider, without adding a
// debug control or scene reference to the application's public surface.
const found=await page.evaluate(()=>{
 const seen=new Set(),queue=window.__DELIVERED_REACT_ROOTS.map(r=>r.current);for(const el of document.querySelectorAll('canvas,canvas *,.game-shell *')){const key=Object.keys(el).find(k=>k.startsWith('__reactFiber'));if(key)queue.push(el[key]);}
 while(queue.length&&seen.size<100000){const obj=queue.shift();if(!obj||typeof obj!=='object'||seen.has(obj))continue;seen.add(obj);
  if(typeof obj.getState==='function'){const state=obj.getState();if(state?.scene?.isScene&&state?.gl){window.__DELIVERED_RENDERER=state;return true;}}
  if(obj.__r3f?.root){window.__DELIVERED_RENDERER=obj.__r3f.root.getState();return true;}
  for(const key of ['child','sibling','return','memoizedState','memoizedProps','next','value','current','stateNode','containerInfo','store'])if(obj[key]&&typeof obj[key]==='object')queue.push(obj[key]);
 }return {visited:seen.size};
});
console.log({found,responses});
await page.screenshot({path:`${output}/world.png`});
if(found!==true){await browser.close();throw new Error('Renderer provider not found');}
const names=await page.evaluate(()=>{const names=[];window.__DELIVERED_RENDERER.scene.traverse(n=>{if(n.name.includes('delivered')||n.name==='bakery-entrance-threshold')names.push(n.name);});return names;});
for(const [label,targetName] of [['oven','delivered:oven'],['dairy','retail-department:dairy'],['eggs','retail-department:eggs'],['chicken','dynamic:delivered-chicken'],['cow','dynamic:delivered-cow']]){
 const ok=await page.evaluate(({targetName})=>{
  const s=window.__DELIVERED_RENDERER,target=s.scene.getObjectByName(targetName);if(!target)return false;
  // A clone captures the integrated lighting, fixture and animations without
  // fighting the gameplay camera controller. Render the original scene with
  // an inspection camera on each animation frame for the short QA recording.
  const p=target.getWorldPosition(s.camera.position.clone()),c=s.camera.clone();
  c.position.copy(p).add({x:5,y:5,z:7});p.y+=1.2;c.lookAt(p);if(c.isOrthographicCamera){c.zoom=65;c.updateProjectionMatrix();}
  window.__DELIVERED_INSPECT={camera:c,until:performance.now()+4500};
  if(!window.__DELIVERED_ORIGINAL_RENDER){const render=s.gl.render.bind(s.gl);window.__DELIVERED_ORIGINAL_RENDER=render;s.gl.render=(scene,camera)=>render(scene,scene===s.scene&&window.__DELIVERED_INSPECT?.until>performance.now()?window.__DELIVERED_INSPECT.camera:camera);}
  return true;
 },{targetName});
 if(ok){await page.waitForTimeout(1800);await page.screenshot({path:`${output}/${label}.png`});await page.waitForTimeout(2000);}
}
const contacts=await page.evaluate(()=>{
 const s=window.__DELIVERED_RENDERER,result={};
 for(const kind of ['chicken','cow']){
  const root=s.scene.getObjectByName(`dynamic:delivered-${kind}`),p=root.getWorldPosition(s.camera.position.clone());let minY=Infinity;
  root.traverse(n=>{if(n.isSkinnedMesh){n.skeleton.update();const v=p.clone();for(let i=0;i<n.geometry.attributes.position.count;i++){n.getVertexPosition(i,v).applyMatrix4(n.matrixWorld);minY=Math.min(minY,v.y);}}});
  const ray=new s.raycaster.constructor();ray.set(p.clone().add({x:0,y:5,z:0}),p.clone().set(0,-1,0));
  const hits=ray.intersectObjects(s.scene.children,true).slice(0,10).map(h=>({y:h.point.y,name:h.object.name,material:h.object.material?.name}));result[kind]={root:p.toArray(),minY,hits};
 }return result;
});
const motion=await page.evaluate(()=>new Promise(resolve=>{
 const samples={chicken:[],cow:[]},scene=window.__DELIVERED_RENDERER.scene,started=performance.now();
 const timer=setInterval(()=>{
  for(const kind of ['chicken','cow']){const animal=scene.getObjectByName(`dynamic:delivered-${kind}`);samples[kind].push({x:animal.position.x,neck:animal.getObjectByName('Neck').rotation.z});}
  if(performance.now()-started>=24000){clearInterval(timer);resolve(Object.fromEntries(Object.entries(samples).map(([kind,rows])=>[kind,{travel:Math.max(...rows.map(r=>r.x))-Math.min(...rows.map(r=>r.x)),neckRange:Math.max(...rows.map(r=>r.neck))-Math.min(...rows.map(r=>r.neck))}])));}
 },100);
}));
const dairyDoors=await page.evaluate(()=>[1,2,3].map(i=>window.__DELIVERED_RENDERER.scene.getObjectByName(`DairyDoor${i}`)?.rotation.y??null));
const report={generatedAt:new Date().toISOString(),names,responses,errors,contacts,motion,dairyDoors};await fs.writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();console.log(report);
if(errors.length||responses.some(r=>r.status!==200)||!names.includes('dynamic:delivered-cow')||!names.includes('dynamic:delivered-chicken'))throw new Error('Delivered runtime failed');
for(const [kind,contact] of Object.entries(contacts)){
 const ground=contact.hits.find(h=>h.name===`farm-paddock-ground:${kind}`);
 if(!ground||contact.minY<ground.y-.01||contact.minY>ground.y+.06)throw new Error(`${kind}: invalid ground contact ${JSON.stringify(contact)}`);
}
for(const [kind,sample] of Object.entries(motion))if(sample.travel<.3||sample.neckRange<.8)throw new Error(`${kind}: walking/feeding not observed ${JSON.stringify(sample)}`);
if(dairyDoors.some(angle=>angle===null||angle>-.9))throw new Error(`Dairy doors did not open for a customer: ${JSON.stringify(dairyDoors)}`);
