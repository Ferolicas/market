import {writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {savePayloadSchema} from '../src/lib/game-validation.ts';
const schema=z.toJSONSchema(savePayloadSchema,{io:'input',override:({zodSchema,jsonSchema})=>{
  // JSON Schema input mode omits tuple exactness and regex flags.
  const def=zodSchema._zod.def;
  if(def.type==='tuple'&&!def.rest)jsonSchema.minItems=jsonSchema.maxItems=def.items.length;
  for(const check of def.checks??[])if(check._zod.def.pattern?.flags.includes('i')&&jsonSchema.pattern)jsonSchema.pattern='(?i)'+jsonSchema.pattern;
}});
// The source's post-transform default is not represented in input JSON Schema.
schema.properties.state.properties.franchises.items.properties.registerCashMinor.default=[0,0,0];
await writeFile('godot/game/persistence/save-schema.json',JSON.stringify(schema)+'\n');
const keys=new Set();function walk(v){if(!v||typeof v!=='object')return;if(!Array.isArray(v)){Object.keys(v).forEach(k=>keys.add(k));}Object.values(v).forEach(walk);}walk(schema);
console.log(schema.properties.state.properties.franchises.items.properties.registerCashMinor);
