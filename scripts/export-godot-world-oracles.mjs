import {gzipSync} from 'node:zlib';
import {writeFile} from 'node:fs/promises';
import {createInitialGame,createCampaignGame,normalizeGameState,advanceWorld} from '../src/game/engine.ts';
import {COUNTRIES} from '../src/game/catalog.ts';
import {OPENING_PURCHASES} from '../src/game/progression/MartCampaign.ts';
const data={normalize:[],world:[]};
for(const code of Object.keys(COUNTRIES))for(const campaign of [false,true])for(const level of [1,5,12,30]) {
 const initial=campaign?createCampaignGame(code):createInitialGame(code); initial.level=level;
 if(campaign)initial.franchises[0].purchases.purchased=OPENING_PURCHASES.slice(0,level-1).map(p=>p.id);
 const state=normalizeGameState(initial);
 data.normalize.push({before:initial,after:state});
 if(code!=='ES'&&level!==5)continue;
 for(const open of [false,true]) {
  const before=structuredClone(state);before.franchises[0].open=open;
  before.franchises[0].warehouse.wheat=30;before.franchises[0].warehouse.corn=30;
  const checkpoints=[];let current=structuredClone(before);const events=[];
  for(let tick=1;tick<=360;tick++) {
   const worldInput=tick%25===0?{playerDistanceMeters:.75,interactions:[{type:'STOCK',productId:'tomatoes',quantity:1},{type:'CHECKOUT',paymentMethod:'card'}]}:{};
   const result=advanceWorld(current,1000,undefined,worldInput);current=result.state;events.push(...result.events);
   if(tick%60===0)checkpoints.push({tick,result});
  }
  data.world.push({label:`${code} ${campaign?'campaign':'legacy'} L${level} ${open?'open':'closed'}`,before,checkpoints,events});
 }
}
// Restoring actual moving staff exercises clock rebasing and persisted routes.
for(const run of data.world.filter(r=>r.label.startsWith('ES')))for(const checkpoint of run.checkpoints){const before=checkpoint.result.state;data.normalize.push({before,after:normalizeGameState(before)});}
// Per-store clocks, closing, and changing the visited store.
for(const campaign of [false,true]) {
 let before=campaign?createCampaignGame():createInitialGame();
 before.franchises[0].open=true;before.franchises[1].owned=true;before.franchises[1].open=true;
 before.franchises[1].businessDay=8;before.franchises[1].businessMinute=1259.99;
 before.minuteOfDay=1259.99;before=normalizeGameState(before);
 const checkpoints=[];const events=[];let current=structuredClone(before);
 for(let tick=1;tick<=120;tick++){const result=advanceWorld(current,1000,undefined,tick%25===0?{playerDistanceMeters:.75,interactions:[{type:'STOCK',productId:'tomatoes',quantity:1},{type:'CHECKOUT',paymentMethod:'card'}]}:{});current=result.state;events.push(...result.events);if(tick%60===0)checkpoints.push({tick,result});}
 data.world.push({label:`multistore closing ${campaign}`,before,checkpoints,events});
}
await writeFile('godot/tests/fixtures/world-oracles.json.gz',gzipSync(JSON.stringify(data)+'\n'));
console.log(`${data.normalize.length} restores, ${data.world.length} world scenarios`);
