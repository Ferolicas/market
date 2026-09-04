import { chromium } from '../../../node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';

const baseUrl=process.env.MINIMARKET_QA_URL||'https://market.olcas.app';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
const failures=[];
page.on('pageerror',error=>failures.push({type:'pageerror',text:error.stack||error.message}));
page.on('requestfailed',request=>failures.push({type:'requestfailed',text:`${request.method()} ${request.url()} ${request.failure()?.errorText||''}`}));

const response=await page.goto(baseUrl,{waitUntil:'networkidle',timeout:30_000});
const title=await page.title();
await page.click('#start');
await page.locator('#auth.visible').waitFor({state:'visible',timeout:10_000});
const authVisible=await page.locator('#auth').isVisible();
await page.click('[data-mode="register"]');
const registerFields=await page.locator('.register-only').first().isVisible();
await page.click('[data-mode="forgot"]');
const passwordHidden=!(await page.locator('.password-only').isVisible());
await page.click('[data-mode="login"]');
const apiHealth=await page.evaluate(async()=>{const r=await fetch('/api/health');return {status:r.status,body:await r.json()};});
const manifest=await page.evaluate(async()=>{const r=await fetch('/manifest.webmanifest',{cache:'no-store'});const body=await r.json();return {status:r.status,name:body.name,display:body.display};});
const serviceWorker=await page.evaluate(async()=>{
  if(!('serviceWorker' in navigator))return {supported:false,active:false};
  const registration=await Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(()=>resolve(null),8_000))]);
  return {supported:true,active:Boolean(registration?.active),scope:registration?.scope||null};
});
await page.screenshot({path:'/tmp/mini-market-unity-production-auth.png',fullPage:true});
const result={baseUrl,httpStatus:response?.status(),title,authVisible,registerFields,passwordHidden,apiHealth,manifest,serviceWorker,failures};
if(response?.status()!==200)failures.push({type:'assertion',text:'La portada no responde 200'});
if(title!=='Mini Market'||!authVisible||!registerFields||!passwordHidden)failures.push({type:'assertion',text:'El acceso responsive no funciona'});
if(apiHealth.status!==200||apiHealth.body?.database!=='ok')failures.push({type:'assertion',text:'Backend o PostgreSQL no saludables'});
if(manifest.status!==200||manifest.display!=='standalone')failures.push({type:'assertion',text:'Manifest PWA inválido'});
if(!serviceWorker.active)failures.push({type:'assertion',text:'Service worker no activo'});
await writeFile('/tmp/mini-market-unity-production-smoke.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
await browser.close();
if(failures.length)process.exitCode=1;
