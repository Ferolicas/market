/** Execute the actual OverviewCamera frame callback against real Three.js.
 * React hooks are supplied only to capture the component's camera/ref callback;
 * no projection, zoom, damping, position or target formula is reimplemented.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = await import(require.resolve('esbuild', { paths: [require.resolve('tsx')] }));
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
const source = await readFile('src/components/game/MarketScene.tsx', 'utf8');
const names = ['PLAYER_START','PLAYER_SCALE','CAMERA_DISTANCE_FACTOR','CAMERA_PROXIMITY_FACTOR','CHECKOUT_CAMERA_TARGET','CHECKOUT_CAMERA_POSITION'];
const constants = names.map(name => {
  const match = source.match(new RegExp(`^const ${name} = .+;$`, 'm'));
  if (!match) throw Error(`Source constant missing: ${name}`);
  return match[0];
}).join('\n');
const start = source.indexOf('function OverviewCamera(');
const end = source.indexOf('  return <OrthographicCamera', start);
if (start < 0 || end < 0) throw Error('OverviewCamera source not found');
const jsx = source.slice(end, source.indexOf('\n}', end));
const near = jsx.match(/near=\{([^}]+)\}/)?.[1];
const far = jsx.match(/far=\{([^}]+)\}/)?.[1];
if (!near || !far) throw Error('Source camera clipping not found');
const output = path.resolve('.migration-validation/camera-oracle.mjs');
await build({stdin:{contents:`
import * as THREE from 'three';
import { WORLD_SCALE, scaleStorePosition } from './src/game/world-scale';
import { CHILD_CHARACTER_SCENE_SCALE } from './src/game/animation/CharacterScale';
import { OVERVIEW_CAMERA_OFFSET } from './src/game/render/overview-camera';
import { CHECKOUT_CAMERA_FRAME, CHECKOUT_CAMERA_TARGET as CHECKOUT_CAMERA_TARGET_COORDS, CHECKOUT_CAMERA_POSITION as CHECKOUT_CAMERA_POSITION_COORDS } from './src/game/stations/checkout-layout';
import { dampFactor } from './src/game/locomotion';
${constants}
let size, frame, refs=[], cursor=0;
const useRef = value => refs[cursor++] ??= ({ current: value === null ? new THREE.OrthographicCamera(-size.width/2,size.width/2,size.height/2,-size.height/2,${near},${far}) : value });
const useThree = () => ({size});
const useFrame = callback => { frame = callback; };
${source.slice(start,end)}
  return { camera: camera.current, tick: frame };
}
export { THREE };
export function reset(width,height) { size={width,height}; refs=[]; }
export function render(playerFocus,checkoutFocused) {
 cursor=0;
 return OverviewCamera({playerFocus,checkoutFocused,debug:false});
}
`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:output});
const oracle=await import(pathToFileURL(output));
const cases=[];
for (const [width,height] of [[430,932],[390,844],[393,852],[360,640],[375,667],[768,1024],[1280,720]]) {
 oracle.reset(width,height);
 const focus={current:new oracle.THREE.Vector3(0,0,12.5)};
 const points=[[0,0,37.5],[3,0,37.5],[0,3,37.5],[0,0,34.5],[45.3,0,23.7],[-18,0,-15]];
 const frames=[];
 // Startup, movement, checkout entry/exit and long frames.
 for(let index=0;index<261;index++) {
  const delta=index===100?0.08:1/60;
  focus.current.x=index>100?2:0;
  const checkoutFocused=index>=180 && index<220;
  const state=oracle.render(focus,checkoutFocused);
  state.tick({},delta);
  state.camera.updateMatrixWorld();
  frames.push({delta,checkoutFocused,focus:[focus.current.x*3,0,focus.current.z*3],position:state.camera.position.toArray(),
   zoom:state.camera.zoom,near:state.camera.near,far:state.camera.far,
   projected:points.map(p=>{const v=new oracle.THREE.Vector3(...p).project(state.camera);return [(v.x+1)*width/2,(1-v.y)*height/2];})});
 }
 cases.push({width,height,points,frames});
}
await writeFile('godot/tests/fixtures/camera-oracle.json.gz',gzipSync(JSON.stringify(cases)));
console.log(`Actual Three.js OverviewCamera: ${cases.length} viewports, ${cases.reduce((n,c)=>n+c.frames.length,0)} frames`);
