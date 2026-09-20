import {writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {savePayloadSchema} from '../src/lib/game-validation.ts';
import {createInitialGame,advanceWorld} from '../src/game/engine.ts';
const state=createInitialGame();state.franchises[0].open=true;
const active=advanceWorld(state,1000).state;
const uuid='c9d4c7b2-f217-44af-8e3b-2b9868195713';
const base={expectedRevision:0,operationId:uuid,deviceId:uuid,sessionId:uuid,state:active};
const cases=[];
function add(label,input,mutation){const result=savePayloadSchema.safeParse(input);cases.push({label,...mutation?{mutation}:{input},success:result.success,...result.success?{data:result.data}:{}});}
add('original active game',base);
function mutate(path,value,remove=false){const input=structuredClone(base);let parent=input;for(const key of path.slice(0,-1))parent=parent[key];if(remove)delete parent[path.at(-1)];else parent[path.at(-1)]=value;add(`${path.join('.')} = ${remove?'undefined':JSON.stringify(value)}`,input,{path,value,remove});}
const paths=[];
function leaves(value,path=[]){if(value&&typeof value==='object'){for(const key of Object.keys(value)){paths.push([...path,key]);leaves(value[key],[...path,key]);}}}
leaves(base);
// Other franchises use the identical schema; mutate the first in depth.
for(let i=paths.length-1;i>=0;i--)if(paths[i][1]==='franchises'&&paths[i].length>2&&paths[i][2]!=='0')paths.splice(i,1);
for(const path of paths){
 // Every field is tested with incompatible values and omitted, including
 // nested runtime fields; the original Zod parser determines acceptance.
 for(const value of [null,true,false,-1,0,1,1.5,'',{},[]])mutate(path,value);
 mutate(path,null,true);
}
for(const value of [[],[0],[1,2],[1,2,3],[1,2,3,4],[0,-1,0]])mutate(['state','franchises','0','registerCashMinor'],value);
for(const value of ['2026-02-30T00:00:00.000Z','2024-02-29T00:00:00Z','2026-09-19T12:13:14+02:00','2026-09-19T12:13:14Z','garbage'])mutate(['state','lastSavedAt'],value);
for(const value of [Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,1e100])mutate(['state','balanceMinor'],value);
mutate(['state','avatar','skin'],'#ABCDEF');mutate(['state','avatar','skin'],'#abcd');
const extras=structuredClone(base);extras.unknown=1;extras.state.unknown=2;add('unknown object fields stripped',extras);
await writeFile('godot/tests/fixtures/validation-oracles.json.gz',gzipSync(JSON.stringify({base,cases})));
console.log(`${cases.length} source Zod parsing scenarios`);
