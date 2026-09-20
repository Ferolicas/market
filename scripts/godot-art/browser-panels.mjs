import assert from 'node:assert/strict';
// Read-only native geometry; transitions use real browser pointer/keyboard input.
export async function verifyManagementPanels(page) {
  const panels={stock:'Inventario',orders:'Pedidos',team:'Equipo',map:'Franquicias',finance:'Finanzas',avatar:'Avatar',help:'Cómo jugar',settings:'Sonido y vibración'};
  const read=()=>page.evaluate(()=>window.__marketGodotQa);
  const click=async button=>{
    assert.ok(button&&!button.disabled,'Native control must exist and be enabled');
    await page.mouse.click(button.rect[0]+button.rect[2]/2,button.rect[1]+button.rect[3]/2);
  };
  for(const viewport of [{width:1280,height:720},{width:390,height:844},{width:360,height:640}]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(400);
    for(const [panel,title]of Object.entries(panels)) {
      await click((await read()).buttons.find(button=>button.tooltip===title));
      await page.waitForFunction(panel=>window.__marketGodotQa.panel===panel,panel);
      await page.waitForTimeout(300);
      const state=await read(),[x,y,width,height]=state.panelRect;
      assert.ok(x>=-1&&y>=-1&&x+width<=viewport.width+1&&y+height<=viewport.height+1,`${panel} stays inside ${viewport.width}px viewport`);
      const close=state.buttons.find(button=>button.name==='ClosePanel');
      assert.ok(close.rect[0]>=0&&close.rect[1]>=0&&close.rect[0]+close.rect[2]<=viewport.width&&close.rect[1]+close.rect[3]<=viewport.height,'Close button is visible');
      if(panel==='avatar')await page.waitForFunction(()=>window.__marketGodotQa.portraits>=20,{}, {timeout:20000});
      await page.keyboard.down('ArrowLeft');
      await page.waitForTimeout(250);
      await page.keyboard.up('ArrowLeft');
      const position=(await read()).playerPosition;
      assert.ok(Math.hypot(position[0]-state.playerPosition[0],position[1]-state.playerPosition[1])<0.05,'Panel prevents player movement');
      await page.mouse.move(viewport.width/2,Math.min(viewport.height-150,y+height/2));
      await page.mouse.wheel(0,2000);
      await page.waitForTimeout(150);
      assert.deepEqual((await read()).buttons.find(button=>button.name==='ClosePanel').rect,close.rect,'Header does not scroll away');
      await click(close);
      await page.waitForFunction(()=>window.__marketGodotQa.panel==='');
    }
    console.log('PASS: all 8 native panels, fixed close control, bounds and input isolation',viewport);
  }
  await page.setViewportSize({width:1280,height:720});
}
