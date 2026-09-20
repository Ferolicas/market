// Disposable PostgreSQL + original Next backend + real native Godot HTTP tests.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, writeFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
const root = process.cwd();
const installation = process.env.MARKET_QA_PG_INSTALL ?? path.join((await readFile('.migration-validation/postgres-root', 'utf8')).trim(), 'install');
const temporary = await mkdtemp(path.join(tmpdir(), 'market-godot-api-'));
const log = await open(path.join(root, '.migration-validation/live-api-server.log'), 'w');
const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', log.fd, log.fd], ...options });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}; see live-api-server.log`)));
});
const freePort = () => new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const pgPort = await freePort();
const apiPort = await freePort();
const database = `postgresql://market_migration@127.0.0.1:${pgPort}/market_migration`;
const env = { ...process.env, DATABASE_URL: database, NODE_ENV: 'development', AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_SECRET: '', APP_URL: `http://127.0.0.1:${apiPort}`, BETTER_AUTH_URL: `http://127.0.0.1:${apiPort}`, LOCAL_DEV_ORIGINS: `http://127.0.0.1:${apiPort}`, RESEND_API_KEY: '', MARKET_QA_PORT: String(apiPort), MARKET_QA_API_URL: `http://127.0.0.1:${apiPort}`, NEXT_TELEMETRY_DISABLED: '1' };
let backend;
let postgresStarted = false;
try {
  await run(path.join(installation, 'bin/initdb'), ['-D', path.join(temporary, 'data'), '-A', 'trust', '-U', 'market_migration', '--no-locale', '--encoding=UTF8']);
  await run(path.join(installation, 'bin/pg_ctl'), ['-D', path.join(temporary, 'data'), '-l', path.join(temporary, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${pgPort} -k ${temporary}`, '-w', 'start']);
  postgresStarted = true;
  await run(path.join(installation, 'bin/createdb'), ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'market_migration', 'market_migration']);
  await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { env });
  await writeFile('.migration-validation/qa-tsconfig.json', JSON.stringify({ extends: '../tsconfig.json', include: ['../next-env.d.ts', '../src/**/*.ts', '../src/**/*.tsx'], exclude: ['../node_modules'] }));
  backend = spawn(process.execPath, ['scripts/godot-art/qa-api-server.mjs'], { cwd: root, env, stdio: ['ignore', log.fd, log.fd] });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (backend.exitCode !== null) throw new Error('Next backend exited during startup');
    try { const response = await fetch(env.MARKET_QA_API_URL + '/api/health'); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Next QA backend did not become ready');
  // Use an actual Better Auth token from the disposable database; email delivery is disabled.
  const resetEmail = `reset_${randomBytes(8).toString('hex')}@example.invalid`;
  const resetPassword = randomBytes(20).toString('hex');
  const authPost = async (endpoint, body) => {
    const response = await fetch(env.MARKET_QA_API_URL + '/api/auth/' + endpoint, {method:'POST', headers:{'Content-Type':'application/json', Origin:env.MARKET_QA_API_URL}, body:JSON.stringify(body)});
    const data = await response.json();
    if (!response.ok) throw new Error(`Reset fixture ${endpoint}: ${JSON.stringify(data)}`);
    return data;
  };
  const resetUser = await authPost('sign-up/email', {email:resetEmail, password:resetPassword, name:'Password reset QA', username:resetEmail.split('@')[0]});
  await authPost('request-password-reset', {email:resetEmail, redirectTo:env.MARKET_QA_API_URL + '/godot/index.html?auth=reset'});
  const db = new pg.Client({connectionString:database});
  await db.connect();
  try {
    const rows = await db.query('SELECT identifier FROM verification WHERE value = $1 AND identifier LIKE $2', [resetUser.user.id, 'reset-password:%']);
    if (rows.rowCount !== 1) throw new Error('Better Auth must create exactly one real reset token');
    env.MARKET_QA_RESET_TOKEN = rows.rows[0].identifier.slice('reset-password:'.length);
    env.MARKET_QA_RESET_EMAIL = resetEmail;
    env.MARKET_QA_RESET_PASSWORD = resetPassword;
  } finally { await db.end(); }
  await run(process.execPath, ['scripts/qa-godot-browser-recovery.mjs'], { env, stdio: 'inherit' });
  if (process.env.MARKET_QA_WEB === '1') await run(process.execPath, ['scripts/qa-godot-web.mjs'], { env, stdio: 'inherit' });
  if(process.env.MARKET_QA_TOUCH==='1') await run(process.execPath,['scripts/qa-godot-touch.mjs'],{env,stdio:'inherit'});
  console.log('Real isolated PostgreSQL/Next backend ready; running Godot integration suite');
  await run('python3', ['-c', 'import sys; sys.path.insert(0,"godot/tools"); import test; sys.exit(0 if test.run(["godot","--headless","--path","godot","-s","integration/run.gd"],180) else 1)'], { env, stdio: 'inherit' });
} finally {
  if (backend && backend.exitCode === null) {
    backend.kill('SIGTERM');
    await Promise.race([new Promise(resolve => backend.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (backend.exitCode === null) backend.kill('SIGKILL');
  }
  if (postgresStarted) await run(path.join(installation, 'bin/pg_ctl'), ['-D', path.join(temporary, 'data'), '-m', 'fast', '-w', 'stop']);
  await log.close();
  await rm(temporary, { recursive: true, force: true });
}
