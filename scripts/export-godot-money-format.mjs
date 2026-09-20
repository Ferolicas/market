import { writeFile } from 'node:fs/promises';
import { COUNTRIES } from '../src/game/catalog.ts';
const rules = {}, cases = [];
for (const country of Object.values(COUNTRIES)) for (const {currency} of Object.values(COUNTRIES)) {
  const formatter = new Intl.NumberFormat(country.locale, {style:'currency',currency,maximumFractionDigits:currency==='COP'||currency==='CLP'?0:2});
  const parts = formatter.formatToParts(-12345.67);
  const template = parts.map(p=>['integer','group','decimal','fraction'].includes(p.type)?'#':p.value).join('').replace(/#+/g,'{number}');
  rules[country.code+':'+currency]={negative:template,positive:formatter.formatToParts(12345.67).map(p=>['integer','group','decimal','fraction'].includes(p.type)?'#':p.value).join('').replace(/#+/g,'{number}'),group:parts.find(p=>p.type==='group')?.value??'',decimal:parts.find(p=>p.type==='decimal')?.value??'',digits:formatter.resolvedOptions().maximumFractionDigits,groupFour:formatter.formatToParts(1234).some(p=>p.type==='group')};
  for(const amount of [0,1,-1,49,50,99,-50,100,123450,123456789,-123456789,9007199254740991]) cases.push({amount,state:{countryCode:country.code,currency},expected:formatter.format(amount/100)});
}
await writeFile('godot/game/core/money-format.json',JSON.stringify(rules)+'\n');
await writeFile('godot/tests/fixtures/money-format-oracles.json',JSON.stringify(cases)+'\n');
