import assert from 'node:assert/strict';
import sharp from 'sharp';
// Real GPU diagnostic: context events, pixels, navigation and native input.
export async function probeContextLoss(page) {
  const dialogs=[],navigations=[];
  const onDialog=async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();};
  const onNavigation=frame=>{if(frame===page.mainFrame())navigations.push(frame.url());};
  page.on('dialog',onDialog);page.on('framenavigated',onNavigation);
  await page.waitForTimeout(1200);
  const initial=await page.evaluate(()=>{
    window.__contextIdentity={};window.__contextInitialIdentity=window.__contextIdentity;
    const canvas=document.querySelector('canvas');
    window.__contextProbe={lost:0,restored:0};
    canvas.addEventListener('webglcontextlost',()=>window.__contextProbe.lost++);
    canvas.addEventListener('webglcontextrestored',()=>window.__contextProbe.restored++);
    return {state:window.__marketGodotQa,timeOrigin:performance.timeOrigin};
  });
  const original=await page.screenshot({path:'.migration-validation/godot-context-before.png'});
  const beforePixels=await sharp(original).resize(96,192,{fit:'fill'}).removeAlpha().raw().toBuffer();
  try {
    for(let round=1;round<=2;round++) {
      await page.evaluate(()=>{
        const extension=document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
        if(!extension)throw Error('WEBGL_lose_context unavailable on actual renderer');
        extension.loseContext();
        // The production adapter must request restoration; the test does not.
      });
      await page.waitForFunction(round=>window.MarketWebGLRecovery?.inspect(document.querySelector('canvas').getContext('webgl2')).restored>=round,round,{timeout:12000});
      await page.waitForTimeout(1200);
      const png=await page.screenshot({path:'.migration-validation/godot-context-restored-'+round+'.png'});
      const after=await page.evaluate(()=>({events:window.__contextProbe,state:window.__marketGodotQa,recovery:window.MarketWebGLRecovery?.inspect(document.querySelector('canvas').getContext('webgl2')),identity:window.__contextIdentity===window.__contextInitialIdentity,timeOrigin:performance.timeOrigin}));
      const stats=await sharp(png).stats();
      const pixels=await sharp(png).resize(96,192,{fit:'fill'}).removeAlpha().raw().toBuffer();
      const meanDifference=pixels.reduce((sum,value,index)=>sum+Math.abs(value-beforePixels[index]),0)/pixels.length;
      console.log('CONTEXT PROBE',JSON.stringify({round,events:after.events,recovery:after.recovery,meanDifference,dialogs,navigations}));
      assert.equal(after.events.lost,round);assert.equal(after.events.restored,round);
      assert.ok(stats.channels.slice(0,3).some(channel=>channel.stdev>5),'Restored context must actually draw the game');
      assert.ok(meanDifference<8,'World and HUD must retain their appearance after recovery');
      assert.equal(after.identity,true,'No page or JS runtime replacement');assert.equal(after.timeOrigin,initial.timeOrigin);
      assert.deepEqual(navigations,[],'No navigation during restoration');assert.deepEqual(dialogs,[]);
      assert.equal(after.state.countryCode,initial.state.countryCode);assert.equal(after.state.tutorialStep,initial.state.tutorialStep);
      assert.equal(after.state.economy.balanceMinor,initial.state.economy.balanceMinor);
      assert.deepEqual(after.state.economy.carry,initial.state.economy.carry);
      assert.deepEqual(after.state.playerPosition,initial.state.playerPosition,'Native player must not reset');
      assert.ok(after.state.renderedFrames>initial.state.renderedFrames);
    }
    await page.keyboard.down('ArrowRight');await page.waitForTimeout(700);await page.keyboard.up('ArrowRight');
    const moved=await page.evaluate(()=>window.__marketGodotQa.playerPosition);
    assert.ok(Math.hypot(moved[0]-initial.state.playerPosition[0],moved[1]-initial.state.playerPosition[1])>0.1,'Actual input/physics must work after restoration');
    console.log('PASS: two automatic GPU recoveries without reload, persistent state, rendered scene and working input');
  } finally {page.off('dialog',onDialog);page.off('framenavigated',onNavigation);}
}
