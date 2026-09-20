import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { transformSync } = require(require.resolve('esbuild', { paths: [require.resolve('tsx')] }));
const source = await readFile('src/components/game/Customer.tsx', 'utf8');
const start = source.indexOf('function customerAnimation(');
const end = source.indexOf('\nfunction setMorph', start);
if (start < 0 || end < 0) throw new Error('Original animation selector not found');
const patience = await readFile('src/game/ai/CustomerPatience.ts', 'utf8');
const code = transformSync(patience.replaceAll('export ', '') + '\n' + source.slice(start, end), { loader: 'ts' }).code;
const liveActors = { simulationTimeMs: 2000 };
const select = new Function('liveActors', code + '\nreturn customerAnimation;')(liveActors);
const states = [...source.slice(start, end).matchAll(/case "([A-Z_]+)"/g)].map(match => match[1]);
states.push('DESPAWN');
const cases = [];
for (const state of states) for (let identity = 1; identity <= 6; identity++) {
  for (const elapsed of [0, 3, 8, 11, 13, 15.5, 17, 18, 33.9]) {
    for (const checkoutLoading of [false, true]) for (const runsFree of [false, true]) {
      for (const [angry, stateSince] of [[false, 0], [true, 501], [true, 500]]) {
        const customer = { state, identity, angry, stateSince };
        cases.push({ customer, elapsed, checkoutLoading, runsFree, simulationTimeMs: liveActors.simulationTimeMs, expected: select(customer, elapsed, checkoutLoading, runsFree) });
      }
    }
  }
}
await writeFile('godot/tests/fixtures/customer-animation-oracles.json', JSON.stringify(cases));
console.log(`${cases.length} original customer animation cases`);
