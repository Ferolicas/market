import { gzipSync } from 'node:zlib';
import {writeFile} from 'node:fs/promises';
import {createInitialGame,createCampaignGame,normalizeGameState,applyGameAction,advanceSimulation} from '../src/game/engine.ts';
import {COUNTRIES,PRODUCTS,ROLE_INFO} from '../src/game/catalog.ts';
import {OPENING_PURCHASES} from '../src/game/progression/MartCampaign.ts';
import {createCrop,createMachine} from '../src/game/stations/StationSystem.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function canonical(result){
 const ids=new Map();
 for(const id of result.state.processedEventIds) if(uuid.test(id)) ids.set(id,`<uuid-${ids.size}>`);
 for(const order of result.state.pendingOrders) if(uuid.test(order.id)) ids.set(order.id,`<uuid-${ids.size}>`);
 for(const f of result.state.franchises) for(const worker of f.employees) if(uuid.test(worker.id)) ids.set(worker.id,`<uuid-${ids.size}>`);
 return JSON.parse(JSON.stringify(result,(_,v)=>typeof v==='string'&&ids.has(v)?ids.get(v):v));
}
const data={actions:[],coarse:[]};
function add(state,action,label){const before=structuredClone(state);const result=applyGameAction(state,action);data.actions.push({label,before,action,after:canonical(result)});}
for(const country of Object.keys(COUNTRIES)) for(const campaign of [false,true]) {
 for(const advanced of [false,true]) {
  let state=campaign?createCampaignGame(country):createInitialGame(country);
  if(advanced){
   state.level=30;state.balanceMinor=COUNTRIES[country].startingCapitalMinor*100;state.simulationTimeMs=100000;
   if(campaign)state.franchises[0].purchases.purchased=OPENING_PURCHASES.map(p=>p.id);
   state=normalizeGameState(state);
   const f=state.franchises[0];f.open=true;f.registerCashMinor=[100,200,300];f.carry={capacity:12,items:{wheat:3,tomatoes:3,flour:2,corn:2}};
   for(const id of Object.keys(PRODUCTS)){f.warehouse[id]=20;f.shelves[id]=0;}
   f.crops=f.crops.map(c=>({...createCrop(c.id,c.productId,0,c.tier,30,c.baseYield),status:'READY',available:8}));
   f.productionMachines=f.productionMachines.map(m=>({...createMachine(m.id,m.productId),status:'WAITING_INPUT',output:2}));
   state.missions.forEach(m=>{m.completed=true;m.progress=m.target;});
  }
  const label=`${country} ${campaign?'campaign':'legacy'} ${advanced?'advanced':'initial'}`;
  const actions=[{type:'SET_AVATAR',hat:'frog',shirt:'#ffffff'},{type:'SET_COUNTRY',countryCode:country==='ES'?'CO':'ES'},{type:'TOGGLE_STORE'}, {type:'DOOR_SENSOR',active:true},{type:'CLOSE_DAY'},{type:'HARVEST'},{type:'HARVEST',productId:'wheat',quantity:20},{type:'HARVEST',quantity:0},{type:'TEND_CROP'},{type:'LOAD_FLOUR_MILL'},{type:'BAKE_BREAD'},{type:'OPERATE_MACHINE',machineId:'cow-station-1'},{type:'OPERATE_MACHINE',machineId:'missing'},{type:'PICKUP_WAREHOUSE'},{type:'PICKUP_WAREHOUSE',productId:'coffee',quantity:5},{type:'RETURN_TO_WAREHOUSE'},{type:'STOCK',productId:'tomatoes',source:'carry',quantity:3},{type:'STOCK',productId:'cannedCorn',quantity:2},{type:'CHECKOUT',paymentMethod:'card'},{type:'BUY_LICENSE'}, {type:'TRAVEL',franchiseId:state.franchises[0].id},{type:'TRAVEL',franchiseId:state.franchises[1].id},{type:'BUY_FRANCHISE',franchiseId:state.franchises[1].id},{type:'CLAIM_MISSION',missionId:`d1-stock`},{type:'CONTRIBUTE_BUILD',amountMinor:100},{type:'UPGRADE_ROSTER',entryId:'player'},...['station','player-speed','player-capacity','employee'].map(upgrade=>({type:'CONTRIBUTE_UPGRADE',upgrade,amountMinor:100000000})),...['shelves','checkout','expansion','mill','bakery'].map(upgrade=>({type:'UPGRADE',upgrade})),...[0,1,2,3].map(lane=>({type:'COLLECT_REGISTER',lane})),...Object.keys(ROLE_INFO).map(role=>({type:'HIRE',role})),...['wheat','coffee','cannedCorn'].map(productId=>({type:'ORDER',productId,supplierId:PRODUCTS[productId].supplier,quantity:5}))];
  for(const action of actions)add(state,action,label);
  for(const minutes of [0,10,200])data.coarse.push({before:state,minutes,after:canonical(advanceSimulation(state,minutes))});
 }
 // Successful purchase paths with task prerequisites satisfied as authored.
 let state=createCampaignGame(country);state.balanceMinor=COUNTRIES[country].startingCapitalMinor*100;
 for(const purchase of OPENING_PURCHASES){
  state.franchises[0].purchases.personalProgress=Object.fromEntries(purchase.tasks?.map(t=>[t.id,100000])??[]);
  // Derive the exact tasks rather than assume purchase graph shape.
  const {purchaseQuote}=await import('../src/game/progression/PurchaseState.ts').then(m=>m.default??m);
  for(const task of purchaseQuote(state.franchises[0].purchases,purchase.id,country).tasks)state.franchises[0].purchases.personalProgress[task.id]=task.target;
  add(state,{type:'CONTRIBUTE_PURCHASE',purchaseId:purchase.id,amountMinor:100000000},`${country} purchase ${purchase.id}`);
  const result=applyGameAction(state,{type:'CONTRIBUTE_PURCHASE',purchaseId:purchase.id,amountMinor:100000000});
  state=result.state;
 }
}
await writeFile('godot/tests/fixtures/action-oracles.json.gz',gzipSync(JSON.stringify(data)+'\n'));
console.log(`${data.actions.length} actions, ${data.coarse.length} coarse ticks`);
