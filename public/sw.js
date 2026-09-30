// ─── Versions ─────────────────────────────────────────────────────────────
// Ces trois lignes sont RÉÉCRITES à chaque build par le greffon
// `provo-service-worker` (vite.config.js) : empreinte des fichiers de l'app,
// liste à précharger, version du moteur OCR. En développement elles restent
// telles quelles.
//
// Le nom du cache était une constante (`provo-v3`), identique d'un déploiement
// à l'autre : les fichiers de chaque version s'y empilaient sans jamais être
// purgés, et le moteur OCR n'était jamais renouvelé — contrairement à ce que
// disait ce fichier. Et comme `sw.js` ne changeait jamais, le téléphone ne
// voyait même pas qu'une nouvelle version existait (audit du 30 septembre 2026).
const VERSION = 'dev';
const PRECACHE = [];
const VERSION_OCR = 'dev';

const CACHE = `provo-app-${VERSION}`;
const TILE_CACHE = 'provo-tiles-v1';
// Le moteur OCR (4,5 Mo) a son cache à lui, nommé d'après sa version : il ne
// se retélécharge que quand tesseract.js change, pas à chaque déploiement.
const OCR_CACHE = `provo-ocr-${VERSION_OCR}`;
// Les caches de l'app d'une version précédente : on garde la dernière, parce
// qu'une page encore ouverte peut réclamer un fichier de SA version (un
// morceau chargé à la demande), que le nouveau déploiement ne sert plus.
const EST_CACHE_APP = (k) => k.startsWith('provo-app-') || k === 'provo-v3';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all([
      fetch('/').then((r) => c.put('/', r)),
      // Toute l'app d'avance, pas seulement ce qu'on a déjà ouvert en ligne :
      // l'écran qu'on découvre hors ligne à l'étranger doit exister. Un fichier
      // qui échoue n'empêche pas les autres.
      ...PRECACHE.map((u) => c.add(u)),
    ].map((p) => p.catch(() => {}))))
  );
  // Activate the new worker right away so refreshes pick up the latest deploy.
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => {
        // `keys()` rend les caches dans leur ordre de création : les deux
        // derniers caches de l'app sont la version courante et la précédente.
        const apps = keys.filter(EST_CACHE_APP);
        const garder = new Set([...apps.slice(-2), CACHE, TILE_CACHE, OCR_CACHE]);
        return Promise.all(keys.filter((k) => !garder.has(k)).map((k) => caches.delete(k)));
      })
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

  // Cache-first. Le rafraîchissement en tâche de fond ne sert qu'aux fichiers
  // dont le nom ne change pas avec leur contenu (manifeste, icônes).
  //
  // Pas pour `/assets/` : le nom porte l'empreinte du contenu, une copie en
  // cache ne peut pas être périmée. Pas pour `/tesseract/` : le moteur OCR
  // pèse 4,5 Mo, et le re-télécharger à CHAQUE lecture de ticket coûtait la
  // donnée mobile d'un séjour à l'étranger (audit A-036). Il se renouvelle
  // quand sa version change (OCR_CACHE), pas à chaque déploiement.
  const ocr = url.pathname.startsWith('/tesseract/');
  const fige = url.pathname.startsWith('/assets/') || ocr;
  e.respondWith(
    caches.open(ocr ? OCR_CACHE : CACHE).then(async (cache) => {
      // Cherché dans TOUS les caches : un fichier de la version précédente,
      // demandé par une page encore ouverte, est dans le cache d'avant.
      const cached = await caches.match(e.request);
      if (cached && fige) return cached;
      const fetchPromise = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        // Hors ligne et rien en cache : une vraie erreur. Rendre `index.html`
        // à la place d'un script faisait exécuter du HTML au moteur OCR.
        .catch(() => cached || new Response('', { status: 503 }));
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
  // Les deux chemins affectent `d` : l'initialiser en plus ne servait à rien
  // (signalé par ESLint), et laissait croire qu'un troisième cas existait.
  let d;
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
