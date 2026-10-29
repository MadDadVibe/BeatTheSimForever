// Makes the game work offline once it has been opened. Files with a version in their address (the engine's files,
// ?v=...) and Vite's hashed assets never change, so they come from the cache; everything else (the page itself)
// from the network when there is one.
const CACHE = 'beat-the-sim';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// The page sends what it loaded before this worker took over (its first visit), so that is offline too.
self.addEventListener('message', (e) => {
  const urls = (e.data && e.data.cache) || [];
  e.waitUntil(Promise.all(urls.map(async (u) => {
    const url = new URL(u, self.location.href);
    if (url.origin !== self.location.origin) return;
    const cache = await caches.open(CACHE);
    if (await cache.match(url.href)) return;
    try {
      await (url.searchParams.has('v') || url.pathname.includes('/assets/') ? cacheFirst(new Request(url.href), url) : networkFirst(new Request(url.href)));
    } catch {
      // Offline already; it gets cached on a later visit.
    }
  })));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const fixed = url.searchParams.has('v') || url.pathname.includes('/assets/');
  e.respondWith(fixed ? cacheFirst(e.request, url) : networkFirst(e.request));
});

async function cacheFirst(request, url) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    // Drop older versions of the same file.
    if (url.searchParams.has('v')) {
      for (const old of await cache.keys()) {
        const o = new URL(old.url);
        if (o.pathname === url.pathname && o.search !== url.search) await cache.delete(old);
      }
    }
    await cache.put(request, res.clone());
  }
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}
