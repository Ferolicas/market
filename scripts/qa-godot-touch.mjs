import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
const origin=process.env.MARKET_QA_API_URL;
if(!origin?.startsWith('http://127.0.0.1:'))throw Error('Requires isolated QA backend');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN??'/home/ferney_oliveros/.local/bin/google-chrome',args:['--no-sandbox','--enable-gpu','--ignore-gpu-blocklist','--use-angle=vulkan','--enable-features=Vulkan']});
let page;
const errors=[];
try {
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
 const id='touch_'+randomUUID().replaceAll('-','').slice(0,12);
 const response=await context.request.post(origin+'/api/auth/sign-up/email',{headers:{Origin:origin},data:{email:id+'@example.invalid',username:id,password:randomUUID(),name:'Touch QA'}});
 assert.equal(response.status(),200);
 page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'||/SCRIPT ERROR|ERROR:/.test(message.text()))errors.push(message.text());});
 await page.goto(origin+'/godot/index.html#qa=1',{timeout:120000});
 await page.waitForFunction(()=>window.__marketGodotQa?.panel==='setup',{}, {timeout:120000});
 const geometry=await page.evaluate(()=>({css:[innerWidth,innerHeight],buffer:[document.querySelector('canvas').width,document.querySelector('canvas').height],panel:window.__marketGodotQa.panelRect}));
 console.log('TOUCH DISPLAY',geometry);
 assert.ok(geometry.panel[0]>=0&&geometry.panel[0]+geometry.panel[2]<=390,'Native UI uses CSS dimensions on high-DPI canvas');
 const cdp=await context.newCDPSession(page);
 const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:0,radiusX:5,radiusY:5,force:1}]});
 let opened=false;
 for(let attempt=0;attempt<18;attempt++) {
  const state=await page.evaluate(()=>window.__marketGodotQa);
  const button=state.buttons.find(button=>button.text==='Abrir mi primer Mini Market');
  const [x,y,w,h]=button.rect,[bx,by,,bh]=state.panelBodyRect;
  if(y>=by&&y+h<=by+bh) {await page.touchscreen.tap(x+w/2,y+h/2);opened=true;break;}
  // Avatar dragging intentionally rotates the model in both implementations.
  // Begin scrolling on the surrounding form instead of the orbit surface.
  const preview=state.avatarPreviewRect??[];
  const startY=[by+bh-25,by+Math.min(220,bh-25),by+80].find(y=>preview.length===0||y<preview[1]||y>preview[1]+preview[3]);
  assert.notEqual(startY,undefined,'A touch scroll origin exists outside avatar orbit');
  await touch('touchStart',bx+2,startY);
  for(let step=1;step<=8;step++){await touch('touchMove',bx+2,startY-step*(startY-by-20)/8);await page.waitForTimeout(25);}
  await touch('touchEnd');await page.waitForTimeout(400);
  console.log('TOUCH SCROLL',attempt,button.rect[1]);
 }
 assert.ok(opened,'Actual touch scroll reaches onboarding confirmation');
 await page.waitForFunction(()=>window.__marketGodotQa?.tutorialStep>0&&window.__marketGodotQa.saveRevision>=2&&window.__marketGodotQa.sceneSettled&&!window.__marketGodotQa.loading,{}, {timeout:60000});
 const before=await page.evaluate(()=>window.__marketGodotQa);
 assert.equal(before.countryCode,'ES','Panning over country buttons must cancel their click');
 assert.equal(before.renderProfile.mobile,true);
 assert.equal(before.renderProfile.glassTransmission,false);
 assert.ok(before.renderDpr>1,'Real high-DPI backing buffer is active');
 await touch('touchStart',195,500);
 await touch('touchMove',130,500);
 await page.waitForFunction(()=>window.__marketGodotQa.movement.pointer!==null&&window.__marketGodotQa.movement.input.magnitude>0);
 await page.waitForTimeout(1200);
 const moved=await page.evaluate(()=>window.__marketGodotQa);
 assert.ok(Math.hypot(moved.playerPosition[0]-before.playerPosition[0],moved.playerPosition[1]-before.playerPosition[1])>0.5,'Touch drag moves actual native physics');
 await touch('touchEnd');
 await page.waitForFunction(()=>window.__marketGodotQa.movement.pointer===null&&window.__marketGodotQa.movement.input.magnitude===0);
 const settings=await page.evaluate(()=>window.__marketGodotQa.buttons.find(button=>button.tooltip==='Sonido y vibración'));
 await page.touchscreen.tap(settings.rect[0]+settings.rect[2]/2,settings.rect[1]+settings.rect[3]/2);
 await page.waitForFunction(()=>window.__marketGodotQa.panel==='settings');
 const close=await page.evaluate(()=>window.__marketGodotQa.buttons.find(button=>button.name==='ClosePanel').rect);
 await page.touchscreen.tap(close[0]+close[2]/2,close[1]+close[3]/2);
 await page.waitForFunction(()=>window.__marketGodotQa.panel==='');
 assert.deepEqual(errors,[],'Touch/high-DPI path stays free of engine and browser errors');
 await page.screenshot({path:'.migration-validation/godot-touch-dpr2.png'});
 console.log('PASS: actual touch scrolling, onboarding, drag physics, release and panel controls at DPR 2',before.renderProfile);
} catch(error) {if(page){await page.screenshot({path:'.migration-validation/godot-touch-failure.png'});console.error('Touch failure',errors,await page.evaluate(()=>window.__marketGodotQa));}throw error;} finally {await browser.close();}
