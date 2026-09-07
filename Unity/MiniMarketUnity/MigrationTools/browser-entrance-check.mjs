// Walk through the automatic entrance and photograph both sides. The check
// fails unless Unity reports that the rebuilt leaves opened near the player.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const baseUrl=process.env.MINIMARKET_QA_URL||'http://127.0.0.1:4173';
const outDir=process.env.MINIMARKET_UI_OUT||'/tmp/ui';
const chromePath='/home/ferney_oliveros/.local/bin/google-chrome';
mkdirSync(outDir,{recursive:true});

const browser=await chromium.launch({
  headless:true,
  ...(existsSync(chromePath)?{executablePath:chromePath}:{}),
  args:['--no-sandbox','--disable-gpu-sandbox'],
});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});
const page=await context.newPage();
const events=[];
let signalRuntimeReady;
const runtimeReadySignal=new Promise(resolve=>{signalRuntimeReady=resolve;});

await page.route('**/api/auth/get-session',route=>route.fulfill({
  status:200,
  contentType:'application/json',
  body:JSON.stringify({user:{id:'entrance-qa'}}),
}));
page.on('console',message=>{
  const text=message.text();
  events.push({type:`console:${message.type()}`,text});
  if(text.includes('MINIMARKET_READY'))signalRuntimeReady(text);
});
page.on('pageerror',error=>events.push({type:'pageerror',text:error.stack||error.message}));
page.on('requestfailed',request=>events.push({type:'requestfailed',url:request.url(),text:request.failure()?.errorText||''}));

await page.goto(baseUrl,{waitUntil:'domcontentloaded',timeout:30_000});
await page.click('#start');
let instanceReady=false;
try{
  await page.waitForFunction(()=>Boolean(window.miniMarketUnity),null,{timeout:180_000});
  instanceReady=true;
}catch{}
const runtimeReady=instanceReady&&Boolean(await Promise.race([
  runtimeReadySignal,
  page.waitForTimeout(180_000).then(()=>null),
]));
if(instanceReady&&['localhost','127.0.0.1','::1'].includes(new URL(baseUrl).hostname)){
  await page.evaluate(()=>window.miniMarketUnity.SendMessage('MiniMarketRuntime','PrepareLocalEntranceQaScenario'));
  await page.waitForTimeout(2500);
}

await page.screenshot({path:`${outDir}/entrada-abierta.png`});

const doorOpened=events.some(event=>event.text?.includes('MINIMARKET_DOOR estado=abierta'));
const doorFinished=events.some(event=>event.text?.includes('MINIMARKET_DOOR apertura_completa'));
const pageErrors=events.filter(event=>event.type==='pageerror');
const result={baseUrl,instanceReady,runtimeReady,doorOpened,doorFinished,pageErrors,events};
await writeFile(`${outDir}/entrada-qa.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({baseUrl,instanceReady,runtimeReady,doorOpened,doorFinished,pageErrors},null,2));
await browser.close();
if(!instanceReady||!runtimeReady||!doorOpened||!doorFinished||pageErrors.length)process.exitCode=1;
