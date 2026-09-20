// Original Next routes and middleware, isolated output and loopback listener.
import next from 'next';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
const port = Number(process.env.MARKET_QA_PORT);
if (!port || !process.env.DATABASE_URL?.startsWith('postgresql://market_migration@127.0.0.1:')) throw new Error('QA requires the isolated local database');
const app = next({ dev: true, hostname: '127.0.0.1', port, conf: { distDir: '.migration-validation/next-api', typescript: { tsconfigPath: '.migration-validation/qa-tsconfig.json' } } });
await app.prepare();
const handler = app.getRequestHandler();
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/godot/')) {
    const base = path.resolve(process.env.MARKET_QA_WEB_DIRECTORY ?? '.migration-validation/web');
    const file = path.resolve(base, '.' + decodeURIComponent(url.pathname.slice('/godot'.length)));
    if (!file.startsWith(base + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const info = await stat(file);
      response.setHeader('Content-Length', info.size);
      response.setHeader('Content-Type', ({ '.wasm': 'application/wasm', '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' })[path.extname(file)] ?? 'application/octet-stream');
      createReadStream(file).pipe(response);
    } catch { response.writeHead(404).end(); }
    return;
  }
  return handler(request, response);
});
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
console.log('MARKET_QA_READY');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { server.close(); await app.close(); process.exit(0); });
