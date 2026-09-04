// Compatibilidad con la PWA Next anterior, cuyo registro usaba /sw.js.
// Mantener este alias permite actualizarla limpiamente a Unity y retirar sus
// caches sin pedir al jugador que borre datos del navegador.
// Stamped per build by MiniMarketProjectBuilder. A fixed name meant the
// activate handler never had an older cache to delete, so a new build kept
// reading the previous catalog outside a private window.
const CACHE="mini-market-unity-__MINIMARKET_BUILD_STAMP__";
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(["./","manifest.webmanifest"])).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  // Never proxy Brotli-compressed Unity payloads through CacheStorage.
  if(url.origin!==self.location.origin||url.pathname.startsWith("/api/")||url.pathname.startsWith("/reset-password")||url.pathname.startsWith("/Build/"))return;
  // Streamed catalog and GLBs must revalidate against the server; the HTTP
  // cache is the one layer the per-build cache name cannot invalidate.
  const streamed=url.pathname.includes("/StreamingAssets/");
  event.respondWith(fetch(streamed?new Request(event.request,{cache:"no-cache"}):event.request).then(response=>{
    if(response&&response.status===200){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});}
    return response;
  }).catch(()=>caches.match(event.request)));
});
self.addEventListener("message",event=>{if(event.data?.type==="CLEAR_PRIVATE_CACHE")event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("mini-market-unity-")).map(key=>caches.delete(key)))));});
