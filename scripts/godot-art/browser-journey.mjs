import assert from 'node:assert/strict';
// Read-only native route diagnostics; every action uses actual pointer/UI input.
export async function runFirstSaleJourney(page, clickNativeButton) {
  await page.setViewportSize({width:1280,height:720});
  await page.waitForTimeout(500);
  const samples=[];
  const state = async () => { const snapshot=await page.evaluate(() => window.__marketGodotQa); if(snapshot.fps>0)samples.push(snapshot.fps); return snapshot; };
  async function walk(target) {
    const id = `${target}:${Date.now()}`;
    await page.evaluate(request => { window.__marketGodotRouteRequest=request; }, {id,target});
    await page.waitForFunction(id => window.__marketGodotQa.route?.request===id, id);
    const route=(await state()).route;
    assert.ok(route.points.length>1, `Real Recast route to ${target}: ${JSON.stringify(route)}`);
    await page.mouse.move(300,450);
    await page.mouse.down();
    const forward=[-16/Math.hypot(16,25.75),-25.75/Math.hypot(16,25.75)];
    const right=[-forward[1],forward[0]];
    const neutralizedZones = new Set();
    try {
      // Recast's first point is the projection onto navigable space. The till
      // interaction may stop outside it; skipping it cuts through the counter.
      const points=[...route.points,[route.zone.x*3,route.zone.z*3]];
      routeLoop: for(const [index,point] of points.entries()) {
        const started=Date.now();
        while(true) {
          const snapshot=await state();
          if(snapshot.selectedZones.includes(target)) break routeLoop;
          // A route may enter another workstation on the way out of the till.
          // Both original TS and Godot consume that gesture until release.
          // Supply a real neutral gesture once per crossed station, never
          // change game state or bypass a collision/route failure.
          const workstation = snapshot.movement.workstation;
          if(workstation.waitingForNeutral && !neutralizedZones.has(workstation.zoneId)) {
            neutralizedZones.add(workstation.zoneId);
            await page.mouse.up();
            await page.waitForFunction(() => window.__marketGodotQa.movement.input.magnitude===0 && !window.__marketGodotQa.movement.workstation.waitingForNeutral);
            await page.mouse.move(300,450);
            await page.mouse.down();
            console.log('NEUTRAL GESTURE at crossed workstation',workstation.zoneId);
          }
          const current=snapshot.playerPosition;
          const dx=point[0]-current[0],dz=point[1]-current[1],distance=Math.hypot(dx,dz);
          if(index===points.length-1 ? snapshot.selectedZones.includes(target) : distance<0.2) break;
          assert.ok(Date.now()-started<30000, `Movement blocked on ${target}: ${JSON.stringify({current,point,route,movement:snapshot.movement})}`);
          const magnitude=Math.min(1,distance/3);
          const radius=72,deadzone=7.2;
          const drag=deadzone+(radius-deadzone)*magnitude;
          const x=(dx*right[0]+dz*right[1])/distance;
          const y=-(dx*forward[0]+dz*forward[1])/distance;
          await page.mouse.move(300+x*drag,450+y*drag);
          await page.waitForTimeout(100);
        }
      }
    } finally {
      const frame=(await state()).renderedFrames;
      await page.mouse.up();
      // The original workstation controller requires a neutral input frame
      // between entering a station and the next deliberate movement gesture.
      await page.waitForFunction(frame=>window.__marketGodotQa.renderedFrames>frame+1&&window.__marketGodotQa.movement.pointer===null&&window.__marketGodotQa.movement.input.magnitude===0&&!window.__marketGodotQa.movement.workstation.waitingForNeutral,frame);
    }
    console.log('WALK',target,(await state()).playerPosition);
  }
  await walk('farm:crop-tomato-1');
  await page.waitForFunction(() => window.__marketGodotQa.economy.carry.items.tomatoes>0, {}, {timeout:45000});
  await walk('stock:produce');
  await page.waitForFunction(() => window.__marketGodotQa.economy.shelves.tomatoes>0 && !(window.__marketGodotQa.economy.carry.items.tomatoes>0), {}, {timeout:15000});
  if(!(await state()).economy.open) await clickNativeButton('CERRADO', false);
  await walk('checkout');
  await page.waitForFunction(() => window.__marketGodotQa.economy.customersToday>0, {}, {timeout:180000});
  const paid=await state();
  assert.ok(paid.economy.registerCashMinor[0]>0,'Actual customer paid into till');
  await walk('register-0');
  await page.waitForFunction(() => window.__marketGodotQa.economy.balanceMinor>0, {}, {timeout:15000});
  await walk('purchase:farmer-1');
  await page.waitForFunction(() => (window.__marketGodotQa.economy.purchases?.contributions?.['farmer-1']??0)>0 || window.__marketGodotQa.economy.purchases?.purchased?.includes('farmer-1'), {}, {timeout:15000});
  await page.screenshot({path:'.migration-validation/godot-web-first-sale.png'});
  console.log('PASS: physical pointer journey harvest → stocking → checkout → till → purchase');
  if(samples.length){samples.sort((a,b)=>a-b);console.log('Measured journey FPS', {minimum:samples[0],p10:samples[Math.floor(samples.length*.1)],median:samples[Math.floor(samples.length*.5)],samples:samples.length});}
}
