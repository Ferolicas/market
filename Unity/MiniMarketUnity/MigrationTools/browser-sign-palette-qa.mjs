// Captures every in-store hanging sign from the playable WebGL build. The
// camera visits both panel orientations so reversed legacy TextMesh faces and
// palette regressions are visible in one deterministic QA pass.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const baseUrl=process.env.MINIMARKET_QA_URL||'http://127.0.0.1:4173';
const outDir=process.env.MINIMARKET_UI_OUT||'/tmp/mini-market-sign-palette';
const width=Number(process.env.MINIMARKET_QA_WIDTH||1440);
const height=Number(process.env.MINIMARKET_QA_HEIGHT||900);
const chromePath='/home/ferney_oliveros/.local/bin/google-chrome';
mkdirSync(outDir,{recursive:true});

const browser=await chromium.launch({
  headless:true,
  ...(existsSync(chromePath)?{executablePath:chromePath}:{}),
  args:['--no-sandbox','--disable-gpu-sandbox'],
});
const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
const page=await context.newPage();
const events=[];
let signalRuntimeReady;
const runtimeReadySignal=new Promise(resolve=>{signalRuntimeReady=resolve;});

await page.route('**/api/auth/get-session',route=>route.fulfill({
  status:200,
  contentType:'application/json',
  body:JSON.stringify({user:{id:'sign-palette-qa'}}),
}));
page.on('console',message=>{
  const value=message.text();
  events.push({type:`console:${message.type()}`,text:value});
  if(value.includes('MINIMARKET_READY'))signalRuntimeReady(value);
});
page.on('pageerror',error=>events.push({type:'pageerror',text:error.stack||error.message}));
page.on('requestfailed',request=>events.push({type:'requestfailed',url:request.url(),text:request.failure()?.errorText||''}));

await page.goto(baseUrl,{waitUntil:'domcontentloaded',timeout:30_000});
await page.waitForFunction(()=>Boolean(window.miniMarketUnity),null,{timeout:180_000});
const runtimeReady=Boolean(await Promise.race([
  runtimeReadySignal,
  page.waitForTimeout(420_000).then(()=>null),
]));

const signs=[
  ['frutas-verduras','FreshDepartmentSign'],
  ['lacteos-bebidas','ColdDepartmentSign'],
  ['despensa','PantryDepartmentSign'],
  ['panaderia','BakeryDepartmentSign'],
  ['cajas','CheckoutDepartmentSign'],
];
if(runtimeReady){
  await page.evaluate(()=>window.miniMarketUnity.SendMessage('MiniMarketRuntime','PrepareLocalFurnitureQaScenario'));
  for(const [slug,objectName] of signs){
    await page.evaluate(name=>window.miniMarketUnity.SendMessage('MiniMarketRuntime','ViewLocalHangingSignQa',name),objectName);
    await page.waitForTimeout(1_200);
    await page.screenshot({path:`${outDir}/${slug}.png`});
  }
}

const failures=events.filter(event=>event.type==='pageerror'||event.type==='requestfailed');
const report={baseUrl,runtimeReady,captured:runtimeReady?signs.map(([slug])=>slug):[],failures};
await writeFile(`${outDir}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
await browser.close();
if(!runtimeReady||failures.length)process.exitCode=1;
