/** Reproducible art transfer from source React/Three components; no game server. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {build}=await import(require.resolve('esbuild',{paths:[require.resolve('tsx')]}));
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dequantize} from '@gltf-transform/functions';
import sharp from 'sharp';
import {getDFGLUT} from 'three/src/renderers/shaders/DFGLUTData.js';
import {chromium} from 'playwright';
const root=process.cwd();
const referenceWidth=Number(process.env.MARKET_QA_WIDTH??1280);
const referenceHeight=Number(process.env.MARKET_QA_HEIGHT??720);
const output=path.join(root,'godot/assets/authored');
await mkdir(output,{recursive:true});
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const result=await build({entryPoints:['scripts/godot-art/scene-entry.jsx'],bundle:true,write:false,format:'esm',jsx:'automatic',alias:{'@':path.join(root,'src')},define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'expose-original-authoring-components',setup(builder){
 builder.onLoad({filter:/MarketKit\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8'))
 .replace('return <group position={position} scale={[1, 0.72 + fill * 0.28, 1]}>', 'return <group name="checkout-bag" position={position} scale={[1, 0.72 + fill * 0.28, 1]}>')
 .replace('return <group position={position} scale={scale}>\n    <CartTubeInstances', 'return <group name="bay-cart" position={position} scale={scale}>\n    <CartTubeInstances')
 .replace('visible={machine.output > 0}', 'name="dynamic:animal-output" visible={true}')
 .replace('<StaticInstances transforms={fruits} castShadow>', '<group name="crop-fruits"><StaticInstances transforms={fruits} castShadow>')
 .replace('</StaticInstances>}\n  </group>;\n}\n\nfunction ReadyHarvestGlow', '</StaticInstances></group>}\n  </group>;\n}\n\nfunction ReadyHarvestGlow')
 .replace('<group position={[0, 0.295, 0]}>', '<group name="crop-ready-glow" position={[0, 0.295, 0]}>')
 .replace(/<StaticBatchOptimizer rootRef=\{root\} structureRevision=\{structureRevision\} \/>/g,'')
 .replace('return <group position={scaleStorePosition(position)}','return <group userData={{authoredPosition:position, component: Array.isArray(children) ? "compound" : ((children as any)?.type?.type?.name ?? (children as any)?.type?.name ?? "group")}} position={scaleStorePosition(position)}')+'\nexport {CheckoutBag as GodotCheckoutBag, RetailProduct as GodotRetailProduct, RetailProductBatch as GodotRetailProductBatch, CropPlot as GodotCropPlot, DormantCropPlot as GodotDormantCropPlot, ClosedCheckoutKit as GodotClosedCheckoutKit};\n',loader:'tsx'}));
 builder.onLoad({filter:/Customer\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8'))
 .replace('scale={CART_SCALE} visible={false}', 'name="customer-cart" scale={CART_SCALE} visible={true}')
 .replace('<group ref={handleRef}', '<group name="cart-handle" ref={handleRef}')
 .replace('<group ref={basketSocketRef}', '<group name="cart-basket" ref={basketSocketRef}')
 .replace('<group position={[0, 0.2, 0]} scale={0.86}>', '<group name="cart-bag" position={[0, 0.2, 0]} scale={0.86}>')
  .replace('rotation={[0.03, 0, 0.03]} visible={false}', 'rotation={[0.03, 0, 0.03]} visible={true}')
 + '\nexport {CustomerCart as GodotCustomerCart, CustomerBag as GodotCustomerBag};\n',loader:'tsx'}));
 builder.onLoad({filter:/HarvestBasket\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('<group position={[0, 0.08, 0]}>','<group name="HarvestBasketProducts" position={[0, 0.08, 0]}>'),loader:'tsx'}));
 builder.onLoad({filter:/AvatarThumbnails\.tsx$/},async args=>{const contents=await readFile(args.path,'utf8');const environment=contents.match(/<Environment resolution=\{32\}[\s\S]*?<\/Environment>/)?.[0];if(!environment)throw Error('Original thumbnail environment not found');return {contents:contents+'\nexport function GodotThumbnailEnvironment(){return ('+environment+');}\n',loader:'tsx'};});
 builder.onLoad({filter:/AvatarCustomizer\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('<Canvas events=', '<Canvas onCreated={state=>{(window as any).__marketReferenceState=state;}} events=').replace('<ContactShadows position=', '<ContactShadows name="perf:contact-shadows" position=')+'\nexport {StudioEnvironment as GodotStudioEnvironment};\n',loader:'tsx'}));
 builder.onLoad({filter:/MarketScene\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('onCreated={({ gl }) => configureRendererPolicy(gl, renderProfile)}', 'onCreated={(state) => { (window as any).__marketReferenceState = state; configureRendererPolicy(state.gl, renderProfile); }}')+'\nexport {RearDoorAssembly as GodotRearDoorAssembly, MarketGround as GodotMarketGround, MarketBuilding as GodotMarketBuilding, interactionZoneConfigs as godotInteractionZones};\n',loader:'tsx'}));
}}]});
const server=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/reference-state.json'){res.setHeader('Content-Type','application/json');if(process.env.MARKET_QA_REFERENCE_STATE)res.end(await readFile(process.env.MARKET_QA_REFERENCE_STATE));else res.end('null');return;}
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(req.method==='PUT'&&/^\/export\/(ground|city|building|furniture|farm|crops|basket|carry-products|retail-products|checkout-bag|rear-door|customer-cart|customer-bag|closed-checkouts|product-[A-Za-z]+)\.(glb|json)$/.test(url.pathname)) {
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   await writeFile(path.join(output,path.basename(url.pathname)),Buffer.concat(chunks));res.end('ok');return;
  }
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(`<style>body{margin:0}</style><div id="root" style="width:${referenceWidth}px;height:${referenceHeight}px"></div><script type="module" src="/bundle.js"></script>`);return;}
  if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(result.outputFiles[0].contents);return;}
  const file=path.resolve(root,'public','.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(path.join(root,'public')+path.sep)){res.writeHead(403).end();return;}
  const ext=path.extname(file);res.setHeader('Content-Type',({'.glb':'model/gltf-binary','.webp':'image/webp','.png':'image/png','.ttf':'font/ttf','.wasm':'application/wasm'})[ext]??'application/octet-stream');res.end(await readFile(file));
 }catch(e){res.writeHead(404).end(String(e));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN??'/home/ferney_oliveros/.local/bin/google-chrome',args:['--no-sandbox','--enable-gpu','--ignore-gpu-blocklist','--use-angle=vulkan','--enable-features=Vulkan','--disable-background-timer-throttling']});
 for(const part of process.argv.slice(2).length?process.argv.slice(2):['ground','city','building','furniture','farm','crops','basket','carry-products','retail-products','checkout-bag','rear-door','customer-cart','customer-bag','closed-checkouts',...['wheat','flour','bread','corn','milk','eggs','cheese','apples','tomatoes','oranges','coffee','juice','cannedCorn'].map(id=>'product-'+id)]) {
  const page=await browser.newPage({viewport:{width:referenceWidth,height:referenceHeight}});const errors=[];
  page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
  page.on('console',message=>{if(message.type()==='error'){errors.push(message.text());console.error(message.text());}});
  await page.goto(`http://127.0.0.1:${server.address().port}/?part=${part}`);
  if(part==='auth-art') {
   await page.addStyleTag({content:(await readFile('src/app/globals.css','utf8')).replace('@import "tailwindcss";','')});
   await page.locator('.market-illustration').waitFor();
   await page.addStyleTag({content:'.auth-page,.auth-hero,body{background:transparent}.auth-hero:after,.auth-hero .hero-copy,.auth-hero .brand-pill{visibility:hidden}'});
   await page.locator('.market-illustration').screenshot({path:'godot/assets/ui/auth-market.png',omitBackground:true});
   if(errors.length)throw Error(errors.join('\n'));
   console.log('Original CSS market illustration exported');
   await page.close();continue;
  }
  if(part==='preview-reference') {
   await page.addStyleTag({content:'.avatar-preview-3d{width:355px;height:520px}.avatar-options,.preview-hint{display:none}body{background:#fffaef}'});
   await page.waitForFunction(()=>window.sourceSceneReady,{},{timeout:60000});
   await page.waitForTimeout(2000);
   await page.locator('.avatar-preview-3d').screenshot({path:'/tmp/market-three-avatar-preview.png'});
   const shadow=await page.evaluate(()=>window.exportOriginalContactShadow());
   await sharp(Buffer.from(shadow.data),{raw:{width:shadow.width,height:shadow.height,channels:4}}).flip().png().toFile('/tmp/market-three-preview-contact.png');
   if(errors.length) throw Error(errors.join('\n'));
   console.log('Original AvatarCustomizer rendered with actual dynamic contact atlas');
   await page.close();
   continue;
  }
  if(part==='reference'||part==='preview-lighting'||part==='thumbnail-lighting'){
   await page.waitForFunction(()=>window.sourceSceneReady,{},{timeout:60000});
   await page.waitForTimeout(1000);
   const referenceOutput=part==='reference'?(process.env.MARKET_QA_REFERENCE_OUTPUT??'/tmp/market-three-reference.png'):'/tmp/market-three-preview-lighting.png';
   if(part==='reference'&&process.env.MARKET_QA_OVERVIEW==='1') {
    const png=await page.evaluate(()=>{const state=window.__marketReferenceState;const c=state.get().camera;c.position.set(100,140,100);c.lookAt(0,0,0);c.zoom=1;c.left=-120*1280/720/2;c.right=-c.left;c.top=60;c.bottom=-60;c.updateProjectionMatrix();c.updateMatrixWorld();state.gl.render(state.scene,c);return state.gl.domElement.toDataURL();});
    await writeFile(referenceOutput,Buffer.from(png.split(',')[1],'base64'));
   } else await page.screenshot({path:referenceOutput});
   if(part==='reference') {
    const shadow=await page.evaluate(()=>window.exportOriginalContactShadow());
    await sharp(Buffer.from(shadow.data),{raw:{width:shadow.width,height:shadow.height,channels:4}}).flip().png().toFile('/tmp/market-three-contact.png');
    console.log('Original contact alpha',shadow.data.reduce((maximum,value,index)=>index%4===3?Math.max(maximum,value):maximum,0),shadow.data.filter((value,index)=>index%4===3&&value>0).length);
   }
   if(process.env.MARKET_QA_REFERENCE_STATE) {if(errors.length)throw Error(errors.join('\n'));console.log('Original state rendered from',process.env.MARKET_QA_REFERENCE_STATE);await page.close();continue;}
   const lightingPath = path.join(root, 'godot/assets/lighting');
   await mkdir(lightingPath, {recursive:true});
   await writeFile(path.join(lightingPath, part==='reference'?'market-environment.json':part==='preview-lighting'?'preview-environment.json':'thumbnail-environment.json'), JSON.stringify(await page.evaluate(()=>window.exportOriginalEnvironment())));
   await writeFile(path.join(lightingPath, 'three-dfg.json'), JSON.stringify(Array.from(getDFGLUT().image.data)));
   if(errors.length) throw Error(errors.join('\n'));
   console.log('Original Three scene rendered',errors,JSON.stringify(await page.evaluate(()=>{const {gl,scene}=window.__marketReferenceState;const lights=[];scene.traverse(node=>{if(node.isLight)lights.push({type:node.type,color:node.color.toArray(),intensity:node.intensity,position:node.position.toArray(),matrixWorld:node.matrixWorld.elements,distance:node.distance,decay:node.decay});});return {toneMapping:gl.toneMapping,exposure:gl.toneMappingExposure,lights};})));await page.close();continue;
  }
  await page.waitForFunction(()=>typeof window.exportMarket==='function');
  await page.waitForTimeout(4000);
  if(errors.length)throw Error(errors.join('\n'));
  console.log(part,await page.evaluate(()=>window.exportMarket()));
  const file=path.join(output,part+'.glb');
  const document=await io.read(file);await document.transform(dequantize());
  for(const texture of document.getRoot().listTextures())if(texture.getMimeType()==='image/webp')texture.setImage(await sharp(texture.getImage()).png().toBuffer()).setMimeType('image/png');
  for(const extension of document.getRoot().listExtensionsUsed())if(['KHR_mesh_quantization','EXT_texture_webp'].includes(extension.extensionName))extension.dispose();
  await io.write(file,document);
  await page.close();
 }
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
