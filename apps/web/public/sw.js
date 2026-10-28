// Classic service worker: importScripts works in every service-worker-capable browser, unlike ES
// module workers. The caching rules live in sw-rules.js so they can be unit-tested.
importScripts("/sw-rules.js");

const { CACHE_NAME, cleanOldCaches, isNavigationRequest, OFFLINE_URL, PRECACHE_URLS, shouldCache } =
  self.YenSwRules;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    cleanOldCaches(caches, CACHE_NAME).then(async () => {
      await self.clients.claim();
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const fallback = await cache.match(OFFLINE_URL);
        if (fallback) {
          return fallback;
        }
        return new Response(
          "You are offline. Yen needs a connection to show records or confirm anything.",
          {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        );
      }),
    );
    return;
  }

  if (shouldCache(request)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }
        const networkResponse = await fetch(request);
        if (shouldCache(request, networkResponse)) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      }),
    );
    return;
  }
});
