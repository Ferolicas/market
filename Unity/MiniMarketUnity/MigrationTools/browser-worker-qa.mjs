import { chromium } from '../../../node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';

const baseUrl=process.env.MINIMARKET_QA_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();const events=[];let ready;
const readySignal=new Promise(resolve=>{ready=resolve;});
page.on('console',message=>{const text=message.text();if(/MINIMARKET|Exception|error/i.test(text))events.push({type:message.type(),text});if(text.includes('MINIMARKET_READY'))ready();});
page.on('pageerror',error=>events.push({type:'pageerror',text:error.stack||error.message}));
page.on('requestfailed',request=>events.push({type:'requestfailed',text:`${request.method()} ${request.url()}`}));
await page.goto(baseUrl,{waitUntil:'domcontentloaded',timeout:30_000});
await page.click('#start');
await Promise.race([readySignal,page.waitForTimeout(180_000)]);
await page.waitForFunction(()=>Boolean(window.miniMarketUnity),null,{timeout:30_000});
await page.evaluate(()=>window.miniMarketUnity.SendMessage('MiniMarketRuntime','PrepareLocalWorkerQaScenario'));
for(let sample=0;sample<18;sample+=1){
  await page.waitForTimeout(20_000);
  await page.evaluate(()=>window.miniMarketUnity.SendMessage('Employees','LogWorkerState'));
  if(events.some(event=>/MINIMARKET_WORKERS .*bread(?:Warehouse|Shelf)=[1-9]/.test(event.text)))break;
}
await page.screenshot({path:'/tmp/mini-market-unity-worker-qa.png',fullPage:true});
const result={failures:events.filter(event=>['pageerror','requestfailed'].includes(event.type)),events};
await writeFile('/tmp/mini-market-unity-worker-qa.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));await browser.close();
