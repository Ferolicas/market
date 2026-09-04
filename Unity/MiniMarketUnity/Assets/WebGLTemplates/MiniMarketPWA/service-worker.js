// Stamped per build by MiniMarketProjectBuilder. A fixed name meant the
// activate handler never had an older cache to delete, so a new build kept
// reading the previous catalog outside a private window.
const CACHE="mini-market-unity-__MINIMARKET_BUILD_STAMP__";
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(["./","manifest.webmanifest"])).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  // Unity's .br payloads must go straight from Caddy to the browser. Passing
  // them through CacheStorage can retain Content-Encoding after the body was
  // decoded, causing a second Brotli decode and ERR_CONTENT_DECODING_FAILED.
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
