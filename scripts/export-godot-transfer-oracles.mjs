// Execute the actual original useFrame callbacks, with real Three groups and
// deterministic hook storage; no trajectory formula is duplicated here.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import * as retail from '../src/game/stations/retail-layout.ts';
import { farmPlotById } from '../src/game/stations/farm-layout.ts';
import { WAREHOUSE_RETURN_STATION } from '../src/game/stations/warehouse-layout.ts';
import { PURCHASE_POSITIONS } from '../src/game/stations/purchase-layout.ts';
import { ALL_PURCHASED_AREAS } from '../src/game/stations/fixture-availability.ts';
import { scaleStorePosition, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE } from '../src/game/world-scale.ts';
const require = createRequire(import.meta.url);
const { transformSync } = require(require.resolve('esbuild', { paths: [require.resolve('tsx')] }));
const source = await readFile('src/components/game/MarketScene.tsx', 'utf8');
const context = { THREE, ...Object.fromEntries(Object.entries(retail).filter(([name]) => name !== 'default' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name))), farmPlotById, PURCHASE_POSITIONS, scaleStorePosition, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE, window: {},
  WAREHOUSE_RETURN_LANDING: [WAREHOUSE_RETURN_STATION.position[0] * STORE_LAYOUT_SCALE, 0.3 * STORE_ELEMENT_SCALE, WAREHOUSE_RETURN_STATION.position[2] * STORE_LAYOUT_SCALE] };
const deltaStart = source.indexOf('function visualTransferDelta(');
const deltaCode = source.slice(deltaStart, source.indexOf('\n}', deltaStart) + 2);
const maxDelta = source.match(/const MAX_VISUAL_TRANSFER_DELTA = ([\d.]+);/)[0];
const cases = [];
for (const [kind, component] of Object.entries({ harvest: 'HarvestMagnetBurst', stock: 'StockMagnetBurst', return: 'ReturnMagnetBurst', pay: 'PayMagnetBurst' })) {
  const start = source.indexOf(`function ${component}(`);
  const end = source.indexOf('\n  return <group>', start);
  if (start < 0 || end < 0) throw Error(`Cannot extract ${component}`);
  const body = source.slice(start, end) + '\nreturn { particles, step: capturedFrame };\n}';
  const code = transformSync(maxDelta + '\n' + deltaCode + '\n' + body, { loader: 'ts' }).code;
  for (const quantity of [1, 3, 20]) for (const productId of ['tomatoes', 'oranges', 'bread', 'cannedCorn']) {
    if (kind === 'harvest' && !['tomatoes', 'oranges'].includes(productId)) continue;
    const factory = new Function(...Object.keys(context), `let capturedFrame; const useRef=value=>({current:value}), useMemo=fn=>fn(), useEffect=()=>{}, useFrame=fn=>{capturedFrame=fn}; ${code}; return ${component};`)(...Object.values(context));
    const target = { current: new THREE.Vector3(3, 2, 4) };
    const entry = { kind, productId, quantity, shelfStart: 4, cropId: productId === 'oranges' ? 'crop-orange-1' : 'crop-tomato-1', purchaseId: 'farmer-1' };
    let remaining = Math.min(kind === 'pay' ? 8 : 20, quantity);
    const original = factory({ ...entry, sequence: 1, basketTarget: target, unlockedAreas: ALL_PURCHASED_AREAS, onProgress: (_, value) => { remaining = value; } });
    original.particles.current = Array.from({ length: remaining }, () => new THREE.Group());
    const steps = [];
    for (const delta of [0.016, 0.033, 0.1, 0.4, 0.25, 0.016, 0.5, 0.25, 0.25, 0.25, 0.25, 0.25]) {
      target.current.x += 0.1;
      original.step({}, delta);
      steps.push({ delta, target: target.current.toArray(), remaining, particles: original.particles.current.map(p => ({ visible: p.visible, position: p.position.toArray(), rotation: [p.rotation.x, p.rotation.y, p.rotation.z], scale: p.scale.toArray() })) });
    }
    cases.push({ entry, areas: ALL_PURCHASED_AREAS, steps });
  }
}
await writeFile('godot/tests/fixtures/transfer-oracles.json', JSON.stringify(cases));
console.log(`${cases.length} source transfer traces / ${cases.reduce((n, c) => n + c.steps.length, 0)} frames`);
