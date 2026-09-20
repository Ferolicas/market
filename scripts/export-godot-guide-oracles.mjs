import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { transformSync } = require(require.resolve('esbuild', { paths: [require.resolve('tsx')] }));
const source = await readFile('src/components/game/GameShell.tsx', 'utf8');
const start = source.indexOf('function LevelOneGuide(');
const end = source.indexOf('  return <details', start);
if (start < 0 || end < 0) throw new Error('Source guide not found');
const carry = await readFile('src/game/player/CarrySystem.ts', 'utf8');
const carryStart = carry.indexOf('function carryQuantity(');
const carryEnd = carry.indexOf('\n}', carryStart) + 2;
const code = transformSync(carry.slice(carryStart, carryEnd) + '\n' + source.slice(start, end) + '\nreturn {activeStep,eyebrow,title,description,progress};\n}', { loader: 'ts' }).code;
const guide = new Function(code + '\nreturn LevelOneGuide;')();
const cases = [];
for (const status of ['LOCKED', 'EMPTY', 'GROWING', 'READY']) for (const harvested of [0, 2, 3, 6]) for (const stocked of [0, 2, 3, 6]) for (const quantity of [0, 1, 3]) for (const open of [false, true]) for (const sales of [0, 1]) for (const state of ['ENTER_STORE', 'QUEUE_WAIT']) {
  const game = { simulationTimeMs: 1234, progression: { counters: { 'harvest:tomatoes': harvested, 'stock:tomatoes': stocked, customers: sales } } };
  const franchise = { crops: [{ productId: 'tomatoes', status, plantedAt: 0, readyAt: 2400 }], carry: { capacity: 3, items: { tomatoes: quantity } }, open, customers: [{ state }] };
  cases.push({ game, franchise, expected: guide({ game, franchise }) });
}
await writeFile('godot/tests/fixtures/guide-oracles.json', JSON.stringify(cases));
console.log(`${cases.length} original initial guide cases`);
