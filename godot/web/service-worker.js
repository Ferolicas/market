// Export-time placeholders are replaced by scripts/export-godot.mjs.
// Keep large packs in bounded Cache Storage entries. Some browser backends
// reject a single several-hundred-megabyte cache.put even with free quota.
const CACHE_NAME = 'Mini Market-sw-cache-__VERSION__';
const FILES = __FILES__;
const PACK = '__PACK__';
const PACK_BYTES = __PACK_BYTES__;
const CHUNK_BYTES = 8 * 1024 * 1024;
const absolute = name => new URL(name, self.registration.scope).href;
const manifestKey = absolute(PACK + '?cache-manifest');
const chunkKey = index => absolute(PACK + '?cache-chunk=' + index);
let storingPack;

async function storePack(response, cache) {
  const reader = response.body.getReader();
  let buffer = new Uint8Array(CHUNK_BYTES);
  let used = 0;
  let chunks = 0;
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (let offset = 0; offset < value.length;) {
        const length = Math.min(value.length - offset, CHUNK_BYTES - used);
        buffer.set(value.subarray(offset, offset + length), used);
        used += length;
        offset += length;
        bytes += length;
        if (used === CHUNK_BYTES) {
          await cache.put(chunkKey(chunks++), new Response(buffer));
          buffer = new Uint8Array(CHUNK_BYTES);
          used = 0;
        }
      }
    }
    if (used) await cache.put(chunkKey(chunks++), new Response(buffer.slice(0, used)));
    if (bytes !== PACK_BYTES) throw new Error('Incomplete game pack');
    // Commit only after every body is durable; an interrupted download is
    // never advertised as an offline-ready game.
    await cache.put(manifestKey, new Response(JSON.stringify({ chunks, bytes })));
  } finally { reader.releaseLock(); }
}

async function cachedPack(cache) {
  const entry = await cache.match(manifestKey);
  if (!entry) return null;
  const manifest = await entry.json();
  if (manifest.bytes !== PACK_BYTES) return null;
  let index = 0;
  const body = new ReadableStream({
    async pull(controller) {
      if (index === manifest.chunks) { controller.close(); return; }
      try {
        const chunk = await cache.match(chunkKey(index++));
        if (!chunk) throw new Error('Missing cached game pack chunk');
        controller.enqueue(new Uint8Array(await chunk.arrayBuffer()));
      } catch (error) { controller.error(error); }
    }
  });
  return new Response(body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(manifest.bytes) } });
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('Mini Market-sw-cache-') && name !== CACHE_NAME).map(name => caches.delete(name)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const name = url.pathname.slice(scope.pathname.length);
  // Account and save requests remain network-only; only exported game files
  // belong to this cache, just as in the original browser application.
  if (name !== PACK && !FILES.includes(name)) return;
  if (name === PACK) {
    const result = caches.open(CACHE_NAME).then(async cache => {
      const cached = await cachedPack(cache);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok && !storingPack) {
        storingPack = storePack(response.clone(), cache).finally(() => { storingPack = null; });
      }
      return response;
    });
    event.respondWith(result);
    event.waitUntil(result.then(() => storingPack));
    return;
  }
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const cached = await cache.match(absolute(name));
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(absolute(name), response.clone());
    return response;
  }));
});
self.addEventListener('message', event => {
  if (event.origin !== self.location.origin || !event.source?.id) return;
  event.waitUntil((async () => {
    if (!await self.clients.get(event.source.id)) return;
    if (event.data === 'claim' || event.data === 'update') {
      await self.skipWaiting();
      await self.clients.claim();
      if (event.data === 'update') for (const client of await self.clients.matchAll()) client.navigate(client.url);
    } else if (event.data === 'clear') await caches.delete(CACHE_NAME);
  })());
});
