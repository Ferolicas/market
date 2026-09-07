#!/usr/bin/env node

const baseUrl=(process.env.LOAD_TEST_BASE_URL??"http://127.0.0.1:3000").replace(/\/$/,"");
const durationSeconds=Number(process.env.LOAD_TEST_DURATION_SECONDS??10);
const concurrency=Number(process.env.LOAD_TEST_CONCURRENCY??4);
const cookie=process.env.LOAD_TEST_COOKIE??"";
const mode=process.env.LOAD_TEST_MODE??"health";
const allowedModes=new Set(["health","config","save-read","save-write"]);

if(!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds>300)throw new Error("LOAD_TEST_DURATION_SECONDS debe estar entre 1 y 300");
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>100)throw new Error("LOAD_TEST_CONCURRENCY debe estar entre 1 y 100");
if(/market\.olcas\.app/i.test(baseUrl)&&process.env.ALLOW_PRODUCTION_LOAD_TEST!=="I_UNDERSTAND")
  throw new Error("Carga contra producción bloqueada. Usa staging/local; producción requiere autorización explícita y ALLOW_PRODUCTION_LOAD_TEST=I_UNDERSTAND");
if(!allowedModes.has(mode))throw new Error(`LOAD_TEST_MODE inválido: ${mode}`);
const cookies=process.env.LOAD_TEST_COOKIES_JSON?JSON.parse(process.env.LOAD_TEST_COOKIES_JSON):cookie?[cookie]:[];
if(mode.startsWith("save")&&!cookies.length)throw new Error("LOAD_TEST_COOKIE/LOAD_TEST_COOKIES_JSON es obligatorio para rutas autenticadas de cuentas QA");
if(mode==="save-write"&&cookies.length<concurrency)throw new Error("save-write necesita una cookie QA distinta por worker para evitar conflictos artificiales");

const deadline=Date.now()+durationSeconds*1000;
const latencies=[];let requests=0;let errors=0;

async function worker(index){
  const workerCookie=cookies[index%Math.max(1,cookies.length)];
  let save=null;let saveRevision=0;
  if(mode==="save-write"){
    const initial=await fetch(baseUrl+"/api/game/save",{headers:{cookie:workerCookie}});
    if(!initial.ok)throw new Error(`No se pudo inicializar save QA: HTTP ${initial.status}`);
    const payload=await initial.json();save=payload.state;saveRevision=payload.saveRevision;
  }
  while(Date.now()<deadline){
    const started=performance.now();
    try{
      const path=mode==="health"?"/api/health":mode==="config"?"/api/game/config":"/api/game/save";
      const options={headers:workerCookie?{cookie:workerCookie}:undefined};
      if(mode==="save-write"){
        save={...save,revision:Number(save.revision??0)+1,lastSavedAt:new Date().toISOString()};
        Object.assign(options,{method:"PUT",headers:{cookie:workerCookie,"content-type":"application/json"},body:JSON.stringify({expectedRevision:saveRevision,sessionId:crypto.randomUUID(),state:save,events:[]})});
      }
      const response=await fetch(baseUrl+path,options);
      const responseBody=await response.arrayBuffer();
      if(mode==="save-write"&&response.ok){const payload=JSON.parse(new TextDecoder().decode(responseBody));saveRevision=payload.saveRevision;}
      if(!response.ok)errors++;
    }catch{errors++;}
    latencies.push(performance.now()-started);requests++;
  }
}

await Promise.all(Array.from({length:concurrency},(_,index)=>worker(index)));
latencies.sort((a,b)=>a-b);
const percentile=(p)=>latencies[Math.max(0,Math.ceil(latencies.length*p)-1)]??0;
const elapsed=durationSeconds;
console.log(JSON.stringify({baseUrl,mode,concurrency,durationSeconds,requests,rps:Number((requests/elapsed).toFixed(2)),errors,errorRate:Number((errors/Math.max(1,requests)).toFixed(4)),p50Ms:Number(percentile(.5).toFixed(2)),p95Ms:Number(percentile(.95).toFixed(2)),p99Ms:Number(percentile(.99).toFixed(2))},null,2));
if(errors)process.exitCode=1;
