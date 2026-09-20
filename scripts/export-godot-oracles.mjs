import { mkdir, writeFile } from 'node:fs/promises';
import { createInitialGame, createCampaignGame, employeeHiringQuote } from '../src/game/engine.ts';
import { COUNTRIES, ROLE_INFO } from '../src/game/catalog.ts';
import { STORE_OBSTACLES } from '../src/game/world-scale.ts';
const target = new URL('../godot/tests/fixtures/', import.meta.url);
await mkdir(target, { recursive: true });
const data = {
  initial: Object.fromEntries(Object.keys(COUNTRIES).map(code => [code, createInitialGame(code)])),
  campaign: Object.fromEntries(Object.keys(COUNTRIES).map(code => [code, createCampaignGame(code)])),
  hiring: Object.fromEntries(Object.keys(COUNTRIES).map(code => [code, Object.fromEntries(Object.keys(ROLE_INFO).map(role => [role, employeeHiringQuote(role, code)]))])),
  obstacles: STORE_OBSTACLES.map(obstacle => ({ ...obstacle, id: obstacle.id ?? null })),
};
await writeFile(new URL('source-oracles.json', target), JSON.stringify(data) + '\n');
console.log('Exported original TypeScript constructors for seven countries, hiring quotes, and all obstacles.');
