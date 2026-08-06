const CACHE = 'provo-v3';
const TILE_CACHE = 'provo-tiles-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      fetch('/').then((r) => c.put('/', r)).catch(() => {})
    )
  );
  // Activate the new worker right away so refreshes pick up the latest deploy.
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => {
        // Tell open clients a new version is live.
        return self.clients.matchAll({ type: 'window' }).then(clientList => {
          clientList.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
        });
      })
  );
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Cache map tiles from OpenStreetMap (cache-first — they never change).
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

  // HTML navigations: network-first so a freshly deployed version is picked up
  // immediately (the home-screen app stays current), with cache fallback offline.
  if (e.request.mode === 'navigate' || (e.request.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request).then((c) => c || caches.match('/')))
    );
    return;
  }

  // Hashed assets are immutable — cache-first with background refresh.
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

// ─── Notifications ────────────────────────────────────────────────────────
//
// Le Web Push fonctionne sur iPhone depuis iOS 16.4, mais **seulement** pour
// une app ajoutée à l'écran d'accueil. En onglet Safari, l'abonnement échoue :
// c'est une limite du système, pas un bug, et le client le dit franchement.
//
// Ce que l'app envoie tient en une phrase — « Le Belvédère ferme dans 1 h » —
// parce qu'une notification se lit d'un coup d'oeil, sur un écran verrouillé,
// en marchant.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corps: e.data && e.data.text() }; }
  const titre = d.titre || 'Provo';
  e.waitUntil(self.registration.showNotification(titre, {
    body: d.corps || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Une même alerte remplace la précédente au lieu de s'empiler : trois
    // rappels pour la même activité, c'est trois fois moins lu.
    tag: d.tag || 'provo',
    renotify: false,
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const cible = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((liste) => {
      // Rouvrir une fenêtre déjà là plutôt qu'en créer une : l'app garde son
      // état, et on retombe sur l'écran qu'on avait laissé.
      for (const c of liste) {
        if ('focus' in c) { c.navigate && c.navigate(cible); return c.focus(); }
      }
      return self.clients.openWindow(cible);
    })
  );
});
