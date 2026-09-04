import { chromium } from '../../../node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const baseUrl=process.env.MINIMARKET_QA_URL||'https://market.olcas.app';
const chromePath='/home/ferney_oliveros/.local/bin/google-chrome';
const browser=await chromium.launch({headless:true,...(existsSync(chromePath)?{executablePath:chromePath}:{}),args:['--no-sandbox','--disable-gpu-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
const events=[];
let signalRuntimeReady;
const runtimeReadySignal=new Promise(resolve=>{signalRuntimeReady=resolve;});
await page.route('**/api/auth/get-session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user:{id:'production-static-qa'}})}));
page.on('console',message=>{const text=message.text();events.push({type:`console:${message.type()}`,text});if(text.includes('MINIMARKET_READY'))signalRuntimeReady(text);});
page.on('pageerror',error=>events.push({type:'pageerror',text:error.stack||error.message}));
page.on('requestfailed',request=>events.push({type:'requestfailed',url:request.url(),text:request.failure()?.errorText||''}));
page.on('response',response=>{if(response.url().includes('/Build/')||response.url().includes('/StreamingAssets/')||response.status()>=400)events.push({type:'response',status:response.status(),url:response.url(),headers:response.headers()});});

await page.goto(baseUrl,{waitUntil:'domcontentloaded',timeout:30_000});
// Reproduce the real login delay: start only after the PWA worker has claimed
// the page. This is the condition that exposed double Brotli decoding.
await page.evaluate(async()=>{
  if(!('serviceWorker' in navigator))return;
  await Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(resolve,10_000))]);
  if(navigator.serviceWorker.controller)return;
  await Promise.race([new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true})),new Promise(resolve=>setTimeout(resolve,5_000))]);
});
await page.click('#start');
let instanceReady=false;
try{await page.waitForFunction(()=>Boolean(window.miniMarketUnity),null,{timeout:180_000});instanceReady=true;}catch{}
const runtimeReady=instanceReady&&Boolean(await Promise.race([runtimeReadySignal,page.waitForTimeout(180_000).then(()=>null)]));
if(instanceReady&&["localhost","127.0.0.1","::1"].includes(new URL(baseUrl).hostname)){
  await page.evaluate(()=>window.miniMarketUnity.SendMessage('MiniMarketRuntime','PrepareLocalQaScenario'));
  await page.waitForTimeout(1200);
}
const ui=await page.evaluate(()=>({message:document.querySelector('#message')?.textContent||null,progress:document.querySelector('#fill')?.style.width||null,loading:Boolean(document.querySelector('#loading')),unity:Boolean(window.miniMarketUnity)}));
await page.screenshot({path:'/tmp/mini-market-unity-production-game.png',fullPage:true});
const result={baseUrl,instanceReady,runtimeReady,ui,events};
await writeFile('/tmp/mini-market-unity-production-game.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
await browser.close();
if(!instanceReady||!runtimeReady)process.exitCode=1;
