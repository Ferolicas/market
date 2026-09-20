// Reproducible native export, with bounded PWA pack caching for Web.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const godot = process.env.GODOT ?? 'godot';
const version = execFileSync(godot, ['--version'], {encoding:'utf8'}).trim();
if(!/^4\.7\.2(?:\.|$)/.test(version)) throw new Error(`Requires Godot 4.7.2, found ${version}`);
const preset = process.argv[2] ?? 'Web';
const output = path.resolve((process.argv[3]&&!process.argv[3].startsWith('--')?process.argv[3]:undefined) ?? (preset === 'Web' ? '.migration-validation/web/index.html' : '.migration-validation/linux/mini-market.x86_64'));
await mkdir(path.dirname(output), { recursive: true });
if (!process.argv.includes('--postprocess-only')) await new Promise((resolve, reject) => {
  const child = spawn(godot, ['--headless', '--path', 'godot', process.argv.includes('--release') ? '--export-release' : '--export-debug', preset, output], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Godot export failed (${code})`)));
});
if (preset === 'Web') {
  const directory = path.dirname(output);
  const name = path.basename(output, '.html');
  const pack = name + '.pck';
  // Identical imported textures may occur under several authored resource paths.
  // Share only their PCK payload, preserving every path and verified file body.
  execFileSync('python3', ['scripts/godot-pack.py', path.join(directory, pack), '--deduplicate', path.join(directory, pack)], {stdio:'inherit'});
  const enginePath=path.join(directory,name+'.js');
  let engine=await readFile(enginePath,'utf8');
  const marker='/* MARKET_WEBGL_RECOVERY_4_7_2 */';
  if(!engine.includes(marker)) {
    const registration='GL.contexts[handle]=context;';
    const alert='alert("WebGL context lost, please reload the page");';
    if(engine.split(registration).length!==2||engine.split(alert).length!==2) throw Error('Godot Web template changed: review GPU recovery integration');
    engine=engine.replace(registration,registration+marker+'globalThis.MarketWebGLRecovery.install(ctx,{pause:()=>{runtimeKeepalivePush();MainLoop.pause()},resume:()=>{MainLoop.resume();runtimeKeepalivePop()}});').replace(alert,'');
    await writeFile(enginePath,engine);
  }
  engine=engine.replace('pause:()=>MainLoop.pause(),resume:()=>MainLoop.resume()','pause:()=>{runtimeKeepalivePush();MainLoop.pause()},resume:()=>{MainLoop.resume();runtimeKeepalivePop()}');
  await writeFile(enginePath,engine);
  const recoveryFile=name+'.recovery.js';
  await writeFile(path.join(directory,recoveryFile),await readFile('godot/web/context-recovery.js'));
  const htmlPath=path.join(directory,name+'.html');
  let html=await readFile(htmlPath,'utf8');
  if(!html.includes(recoveryFile)) {
    html=html.replace('<head>','<head>\n<script src="'+recoveryFile+'"></script>');
  }
  const configMatch=html.match(/const GODOT_CONFIG = (\{[^\n]+\});/);
  if(!configMatch) throw new Error('Godot Web template changed: missing file-size configuration');
  const config=JSON.parse(configMatch[1]);
  config.fileSizes[pack]=(await stat(path.join(directory,pack))).size;
  html=html.replace(configMatch[0], 'const GODOT_CONFIG = '+JSON.stringify(config)+';');
  await writeFile(htmlPath,html);
  const files = ['.html', '.js', '.offline.html', '.icon.png', '.apple-touch-icon.png', '.audio.worklet.js', '.audio.position.worklet.js', '.wasm'].map(extension => name + extension);
  files.push(recoveryFile);
  const digest = createHash('sha256');
  for (const file of [...files, pack]) digest.update(await readFile(path.join(directory, file)));
  const worker = (await readFile('godot/web/service-worker.js', 'utf8')).replace('__VERSION__', digest.digest('hex')).replace('__FILES__', JSON.stringify(files)).replace('__PACK__', pack).replace('__PACK_BYTES__', String((await stat(path.join(directory, pack))).size));
  await writeFile(path.join(directory, name + '.service.worker.js'), worker);
  console.log('Exported PWA with complete-pack commit and 8 MiB cache entries');
}
