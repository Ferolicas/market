import { gzipSync } from 'node:zlib';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const temporary = resolve('src/game/.godot-checkout-oracle.ts');
const names = ['processCheckoutUnit', 'updateCheckoutTransactions', 'commitCheckoutPayment', 'safeFallbackPath', 'walkPathActor', 'walkCustomerThroughAutomaticDoor', 'walkEmployeeThroughAutomaticDoor', 'queueArrivalPath'];
try {
  await writeFile(temporary, await readFile('src/game/engine.ts', 'utf8') + '\nexport {' + names.join(',') + '};\n', { flag: 'wx' });
  const imported = await import(pathToFileURL(temporary).href);
  const e = imported.default ?? imported;
  const { default: cDefault, ...cNamed } = await import('../src/game/catalog.ts');
  const c = cDefault ?? cNamed;
  const { default: lDefault, ...lNamed } = await import('../src/game/stations/checkout-layout.ts');
  const layout = lDefault ?? lNamed;
  const data = { sales: [], timing: [], paths: [], walking: [], doors: [], avoidance: [] };
  for (const country of Object.keys(c.COUNTRIES)) for (const campaign of [false, true]) for (const lane of [0, 1, 2]) {
    const state = campaign ? e.createCampaignGame(country) : e.createInitialGame(country);
    const franchise = state.franchises[0];
    franchise.open = true;
    franchise.stationTiers['checkout-' + (lane + 1)] = lane + 1;
    franchise.stationTiers['shelves-1'] = 3;
    const customer = { id: 'customer', state: 'WAIT_CHECKOUT', shoppingList: [{productId:'tomatoes',requested:2,picked:2},{productId:'eggs',requested:1,picked:1}], queueJoinedAt: 0, queueSlot: 0, x: layout.CHECKOUT_LANES[lane].customerFront[0], z: layout.CHECKOUT_LANES[lane].customerFront[1], path: [], pathIndex:0, stateSince:0 };
    const transaction = { id: 'transaction', customerId: customer.id, pendingItems: [{productId:'tomatoes',quantity:2,loaded:0,scanned:0,bagged:0},{productId:'eggs',quantity:1,loaded:0,scanned:0,bagged:0}], paymentMethod: lane===1?'cash':'card', state:'CUSTOMER_LOADING',nextUnitIndex:0,paymentCommitted:false,updatedAt:0,lastLoadedAt:0,lastScannedAt:-700,lastBaggedAt:0,checkoutLane:lane };
    franchise.customers.push(customer);
    franchise.checkoutTransactions.push(transaction);
    const before = structuredClone(state);
    const events = [];
    const trace = [];
    for (let step=0;step<160&&!transaction.paymentCommitted;step++) {
      state.simulationTimeMs=step*100;
      const canScan=e.canProcessCheckoutUnit(state,franchise);
      const message=e.processCheckoutUnit(state,franchise,transaction,events);
      e.updateCheckoutTransactions(state,franchise,events);
      trace.push({time:state.simulationTimeMs,canScan,message,transaction:structuredClone(transaction),customer:structuredClone(customer)});
    }
    e.commitCheckoutPayment(state,franchise,transaction,customer,events);
    data.sales.push({before,trace,after:state,events});
  }
  for(const tier of [1,2,5]) for(const cashier of [undefined,{level:1},{level:5}]) {
    const franchise={stationTiers:{'checkout-3':tier},checkoutLevel:1,shelvesLevel:1};
    const transaction={checkoutLane:2};
    data.timing.push({franchise,transaction,cashier:cashier??null,scan:e.checkoutScanInterval(franchise,transaction,cashier),bag:e.checkoutBagInterval(cashier)});
  }
  const points = [[0,9],[0,6],[3.1,-2],[-4.8,-.9],[10,2],[6,-5],[-6,-15],[0,-18],[12,3],[-5,2],[5,0]];
  for(const start of points) for(const target of points) data.paths.push({start,target,path:e.safeFallbackPath(start,target)});
  for(const path of [[],[[0,0]],[[0,1],[0,1.01],[1,1]],[[3.1,5.6],[3.1,-4.4],[0,-4.4]]]) {
    const actor={x:0,z:0,targetX:0,targetZ:0,path,pathIndex:0,speed:1.5,currentSpeed:0};
    const initial=structuredClone(actor);const trace=[];
    for(let step=0;step<120;step++){const arrived=e.walkPathActor(actor,100);trace.push({arrived,actor:structuredClone(actor)});if(arrived)break;}
    data.walking.push({initial,trace});
  }
  for(const who of ['customer','employee']) for(const direction of ['ENTER','EXIT']) for(const open of [false,true]) {
    const initial={x:0,z:direction==='ENTER'?9:7,targetX:0,targetZ:direction==='ENTER'?6:10,path:[[0,direction==='ENTER'?6:10]],pathIndex:0,speed:1.5,currentSpeed:0};
    const actor=structuredClone(initial);const franchise={doorState:open?'OPEN':'CLOSED',doorProgress:open?1:0};const trace=[];
    for(let step=0;step<30;step++){const arrived=who==='customer'?e.walkCustomerThroughAutomaticDoor(actor,franchise,100,direction):e.walkEmployeeThroughAutomaticDoor(actor,franchise,100);trace.push({arrived,actor:structuredClone(actor)});}
    data.doors.push({initial,who,direction,franchise,trace});
  }
  const before=Array.from({length:15},(_,i)=>({id:`c${i}`,state:i%3===0?'WAIT_CHECKOUT':'NAVIGATE_TO_PRODUCT',x:(i%4)*.1,z:Math.floor(i/4)*.15}));
  const after=structuredClone(before);e.applyCustomerAvoidance(after);data.avoidance.push({before,after});
  await writeFile('godot/tests/fixtures/checkout-oracles.json.gz',gzipSync(JSON.stringify(data)+'\n'));
  console.log(Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])));
} finally { await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
