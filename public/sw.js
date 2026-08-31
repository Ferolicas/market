const CACHE = "mini-market-v7";
const PRIVATE_CACHE = "mini-market-private-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== PRIVATE_CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_PRIVATE_CACHE") {
    event.waitUntil(caches.delete(PRIVATE_CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method === "GET" && url.origin === self.location.origin && url.pathname === "/api/auth/get-session") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) event.waitUntil(caches.open(PRIVATE_CACHE).then((cache) => cache.put(request, response.clone())));
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || Response.json(null, { status: 503 }))));
    return;
  }
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) event.waitUntil(caches.open(CACHE).then((cache) => cache.put("/", response.clone())));
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
    return;
  }

  const isLargeStaticAsset = url.pathname.startsWith("/models/") || url.pathname.startsWith("/textures/");
  if (isLargeStaticAsset) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, response.clone())));
      return response;
    })));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => {
    const update = fetch(request).then((response) => {
      if (response.ok && new URL(request.url).origin === self.location.origin) {
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, response.clone())));
      }
      return response;
    });
    return cached || update;
  }));
});
