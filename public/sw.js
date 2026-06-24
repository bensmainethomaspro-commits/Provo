const CACHE = 'provo-v2';
const TILE_CACHE = 'provo-tiles-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      fetch('/').then((r) => c.put('/', r)).catch(() => {})
    )
  );
  // Don't skipWaiting immediately — let clients know first
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => clients.claim())
      .then(() => {
        // Broadcast update notification to all open clients
        return self.clients.matchAll({ type: 'window' }).then(clientList => {
          clientList.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
        });
      })
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Cache map tiles from OpenStreetMap
  if (url.hostname.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        try {
          const res = await fetch(e.request);
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        } catch {
          return cached || new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      const fetchPromise = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached || caches.match('/'));
      return cached || fetchPromise;
    })
  );
});
