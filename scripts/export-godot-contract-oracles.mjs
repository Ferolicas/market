import {writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createCampaignGame, applyGameAction} from '../src/game/engine.ts';
import {COUNTRIES} from '../src/game/catalog.ts';
import {CAMPAIGN_CONTRACTS} from '../src/game/progression/CampaignContracts.ts';
import {OPENING_PURCHASES} from '../src/game/progression/MartCampaign.ts';
const cases = [];
for (const country of Object.keys(COUNTRIES)) for (const contract of CAMPAIGN_CONTRACTS) {
  for (const variant of ['ready','completed','locked','missing-product','unowned','previous-incomplete']) {
    const state = createCampaignGame(country);
    const franchise = state.franchises.find(item => item.id === contract.location);
    franchise.owned = true;
    franchise.purchases ??= structuredClone(state.franchises[0].purchases);
    franchise.purchases.purchased = OPENING_PURCHASES.map(item => item.id);
    franchise.purchases.completedContracts = CAMPAIGN_CONTRACTS.filter(item => item.location === contract.location).slice(0, CAMPAIGN_CONTRACTS.filter(item => item.location === contract.location).indexOf(contract)).map(item => item.id);
    franchise.carry.items = Object.fromEntries(contract.products.map(id => [id, 1]));
    state.currentFranchiseId = franchise.id;
    if (variant === 'completed') franchise.purchases.completedContracts.push(contract.id);
    if (variant === 'locked') franchise.purchases.purchased = [];
    if (variant === 'missing-product') delete franchise.carry.items[contract.products[0]];
    if (variant === 'unowned') franchise.owned = false;
    if (variant === 'previous-incomplete') franchise.purchases.completedContracts = [];
    const action = {type:'DELIVER_CONTRACT', contractId:contract.id};
    cases.push({label:`${country}/${contract.id}/${variant}`, before:structuredClone(state), action, after:applyGameAction(state, action)});
  }
}
await writeFile('godot/tests/fixtures/contract-oracles.json.gz', gzipSync(JSON.stringify(cases)));
console.log(`${cases.length} contract action scenarios from original TypeScript`);
