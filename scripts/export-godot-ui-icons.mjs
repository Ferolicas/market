import { readFile, writeFile, mkdir } from 'node:fs/promises';
const source = await readFile('src/components/game/GameShell.tsx', 'utf8');
const match = source.match(/const GAME_ICON_PATHS[^=]+\s*=\s*(\{[\s\S]*?\n\});/);
if (!match) throw new Error('Original icon paths not found');
const paths = new Function('return (' + match[1] + ')')();
await mkdir('godot/assets/ui', { recursive: true });
for (const [name, strokes] of Object.entries(paths)) {
  await writeFile(`godot/assets/ui/${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b533c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${strokes.map(d => `<path d="${d}"/>`).join('')}</svg>\n`);
}
console.log(`${Object.keys(paths).length} original UI icons exported`);

// Rasterize the original emoji strings with the reference browser's fonts.
// This transfers existing UI art, without inventing replacement illustrations.
const {chromium} = await import('playwright');
const emojiSources = await Promise.all(['src/game/catalog.ts','src/game/progression/RosterUpgrades.ts','src/components/game/GameShell.tsx'].map(file=>readFile(file,'utf8')));
const emojis = [...new Set(emojiSources.flatMap(text=>[...text.matchAll(/"([^"\n]+)"/g)].map(match=>match[1]).filter(text=>/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(text)&&!/[a-zA-Z]/.test(text))))];
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN??'/home/ferney_oliveros/.local/bin/google-chrome'});
try {
 const page=await browser.newPage();
 await mkdir('godot/assets/ui/emoji',{recursive:true});
 for(const emoji of emojis) {
  const data=await page.evaluate(text=>{const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;const ctx=canvas.getContext('2d');ctx.font='64px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,48,51);return canvas.toDataURL('image/png').split(',')[1];},emoji);
  const name=Array.from(emoji).map(character=>character.codePointAt(0).toString(16)).join('-');
  await writeFile(`godot/assets/ui/emoji/${name}.png`,Buffer.from(data,'base64'));
 }
 console.log(`${emojis.length} original emoji illustrations exported`);
} finally {await browser.close();}
