import {gzipSync} from 'node:zlib';
import {writeFile} from 'node:fs/promises';
import {createCustomerMind} from '../src/game/ai/CustomerBrain.ts';
import {unlockedCustomerProducts} from '../src/game/progression/objectives.ts';
const cases=[];
for(const level of [1,2,5,9,13,20,25,30,31])for(let sequence=1;sequence<=100;sequence++) {
 const products=unlockedCustomerProducts(level),seed=sequence*2654435761;
 cases.push({level,products,seed,result:createCustomerMind('customer',products,seed,level)});
}
await writeFile('godot/tests/fixtures/customer-oracles.json.gz',gzipSync(JSON.stringify(cases)+'\n'));
