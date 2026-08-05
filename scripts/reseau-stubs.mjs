/**
 * Le réseau, joué au lieu d'être coupé.
 *
 * Les parcours hors ligne prouvent que l'app tient sans réseau. Ils ne disent
 * rien de ce qui arrive AVEC : est-ce qu'une réponse est bien lue, est-ce
 * qu'une panne se voit, est-ce qu'un service muet laisse un rouage tourner
 * dans le vide ?
 *
 * On ne peut pas répondre en appelant les vrais services : ils sont lents,
 * changeants, limités en débit — et surtout **on ne peut pas leur demander de
 * tomber en panne**. Or c'est précisément là que sont les bugs.
 *
 * Chaque service est donc rejoué ici, avec des réponses de la forme exacte que
 * l'app attend, et une panne au choix. Deux exécutions donnent le même
 * résultat, et « le serveur renvoie 500 » devient un cas de test comme un autre.
 *
 * Le mode `--reseau=reel` court-circuite tout ceci et appelle les vrais
 * services : c'est l'autre question — « sont-ils encore là, et répondent-ils
 * encore ça ? » — et elle se pose ailleurs (GitHub Actions).
 */

/** Réponses de référence, calquées sur ce que les services renvoient vraiment. */
export const REPONSES = {
  // Nominatim : recherche d'un lieu par nom ou adresse.
  nominatim: [{
    place_id: 1, lat: '48.2081743', lon: '16.3738189',
    display_name: 'Café Central, Herrengasse 14, Innere Stadt, Wien, 1010, Österreich',
    name: 'Café Central', class: 'amenity', type: 'cafe', importance: 0.55,
    address: { amenity: 'Café Central', road: 'Herrengasse', house_number: '14',
      city: 'Wien', postcode: '1010', country: 'Österreich', country_code: 'at' },
    extratags: { opening_hours: 'Mo-Sa 08:00-21:00; Su 10:00-18:00', website: 'https://cafecentral.wien' },
    namedetails: { name: 'Café Central' },
  }],

  // Open-Meteo : prévisions journalières.
  meteo: (dates) => ({
    daily: {
      time: dates,
      temperature_2m_max: dates.map((_, i) => 22 + (i % 4)),
      temperature_2m_min: dates.map((_, i) => 12 + (i % 3)),
      weathercode: dates.map((_, i) => [0, 1, 3, 61][i % 4]),
    },
  }),

  // Frankfurter : taux de change.
  taux: { amount: 1, base: 'EUR', date: '2026-08-04', rates: { USD: 1.09, GBP: 0.84, CHF: 0.95, JPY: 172.4 } },

  // Overpass : lieux autour d'un point.
  overpass: { elements: [{ type: 'node', id: 1, lat: 48.2085, lon: 16.3735,
    tags: { name: 'Stephansdom', tourism: 'attraction', opening_hours: 'Mo-Su 06:00-22:00' } }] },

  // Edge Function `extract-place` : ce qu'un lien contient.
  extractPlace: { ok: true, result: {
    title: 'Café Central', address: 'Herrengasse 14, 1010 Wien, Autriche',
    lat: 48.2101, lon: 16.3654, openingHours: 'Mo-Sa 08:00-21:00; Su 10:00-18:00',
    link: 'https://cafecentral.wien', category: 'resto',
  } },

  // Edge Function `enrich-place` : ce que le site du lieu dit.
  enrichPlace: {
    horaires: 'Mo-Sa 08:00-21:00; Su 10:00-18:00',
    prixMin: 12, prixMax: 25, devise: '€',
    description: 'Café viennois historique, réputé pour ses pâtisseries et sa salle voûtée.',
    site: 'https://cafecentral.wien',
    photo: null,
    source: 'site', confiance: 'haute',
  },
  // Le même service quand il n'a rien trouvé — un cas fréquent, et distinct
  // d'une panne : on a cherché, il n'y a rien.
  enrichVide: { horaires: null, prixMin: null, description: null, site: null, photo: null,
    source: 'aucune', confiance: 'basse' },

  wikipedia: { query: { search: [{ title: 'Hofburg', snippet: 'Palais impérial de Vienne' }] } },
};

const json = (corps) => ({ status: 200, contentType: 'application/json',
  body: JSON.stringify(typeof corps === 'function' ? corps() : corps) });

/**
 * Les autres réponses possibles d'un service en bon état. « Rien trouvé » n'est
 * pas une panne : le service a répondu, il n'a simplement rien à dire — et
 * l'app doit traiter les deux cas différemment.
 */
export const VARIANTES = {
  enrichPlace: { vide: REPONSES.enrichVide },
  extractPlace: { aucun: { ok: false } },
  nominatim: { aucun: [] },
  overpass: { aucun: { elements: [] } },
};

/**
 * Les pannes qu'on veut pouvoir provoquer. Une seule ligne dans un parcours
 * suffit alors à demander « et si ce service tombait ? ».
 */
export const PANNES = {
  // Le serveur répond, mais mal.
  err500: { status: 500, contentType: 'text/plain', body: 'Internal Server Error' },
  // Nominatim quand on dépasse une requête par seconde : ce n'est même pas du JSON.
  err429: { status: 429, contentType: 'text/html', body: '<html><body>Too Many Requests</body></html>' },
  // Le pire cas : 200, mais le corps n'est pas ce qu'on croit.
  malforme: { status: 200, contentType: 'application/json', body: '{"pas":"ce qui est attendu"' },
  // Injoignable — coupure réseau, DNS mort, service disparu.
  coupe: null,
};

/**
 * Branche les services sur la page.
 *
 * @param {import('playwright').Page} page
 * @param {string} base — l'app elle-même, jamais interceptée
 * @param {object} plan — { service: 'ok' | nom de panne | réponse sur mesure }
 * @returns {{appels: () => Record<string, number>}} le compte des appels reçus,
 *   qui répond à « ce rouage a-t-il seulement tourné ? »
 */
export async function brancherReseau(page, base, plan = {}) {
  const appels = {};
  const compter = (nom) => { appels[nom] = (appels[nom] || 0) + 1; };

  const servir = async (route, nom, reponseOk) => {
    compter(nom);
    const choix = plan[nom] ?? 'ok';
    if (choix === 'coupe' || choix === null) return route.abort('failed');
    if (typeof choix === 'string' && choix !== 'ok') {
      // Une variante d'abord — c'est une vraie réponse ; une panne ensuite.
      const variante = VARIANTES[nom]?.[choix];
      if (variante !== undefined) return route.fulfill(json(variante));
      const p = PANNES[choix];
      if (p === null) return route.abort('failed');
      if (!p) throw new Error(`ni variante ni panne connue pour ${nom} : « ${choix} »`);
      return route.fulfill(p);
    }
    const corps = choix === 'ok' ? reponseOk : choix;
    return route.fulfill(json(corps));
  };

  // Les dates du voyage sont inconnues d'ici : la météo se calque sur ce que
  // l'app demande, sinon aucune date ne correspondrait et rien ne s'afficherait.
  const datesDemandees = (url) => {
    const u = new URL(url);
    const d = u.searchParams.get('start_date'), f = u.searchParams.get('end_date');
    if (!d || !f) return [];
    const out = []; const cur = new Date(d), fin = new Date(f);
    while (cur <= fin && out.length < 30) {
      out.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  };

  // Posé EN PREMIER, donc de plus faible priorité : Playwright applique les
  // routes dans l'ordre inverse d'enregistrement. Tout service non prévu ci-
  // dessous tombe ici et se voit comme une panne franche, plutôt que de partir
  // chercher sur Internet au milieu d'un test.
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.fallback();
    compter('autre');
    return route.abort('failed');
  });

  const routes = [
    ['**/nominatim.openstreetmap.org/**', 'nominatim', () => REPONSES.nominatim],
    ['**/photon.komoot.io/**', 'photon', () => ({ features: [] })],
    ['**/overpass-api.de/**', 'overpass', () => REPONSES.overpass],
    ['**/api.open-meteo.com/**', 'meteo', null],
    ['**/archive-api.open-meteo.com/**', 'meteo', null],
    ['**/api.frankfurter.app/**', 'taux', () => REPONSES.taux],
    ['**/en.wikipedia.org/**', 'wikipedia', () => REPONSES.wikipedia],
    ['**/router.project-osrm.org/**', 'osrm', () => ({ routes: [{ duration: 900, distance: 3200 }] })],
    ['**/api.rss2json.com/**', 'actualites', () => ({ items: [] })],
  ];

  for (const [motif, nom, reponse] of routes) {
    await page.route(motif, (route) => {
      if (nom === 'meteo') {
        compter('meteo');
        const choix = plan.meteo ?? 'ok';
        if (choix === 'coupe') return route.abort('failed');
        if (typeof choix === 'string' && choix !== 'ok') return route.fulfill(PANNES[choix]);
        return route.fulfill(json(REPONSES.meteo(datesDemandees(route.request().url()))));
      }
      return servir(route, nom, reponse());
    });
  }

  // Les fonctions Edge passent toutes par le même hôte : on les distingue au
  // chemin, sinon un plan de panne sur l'une couperait l'autre.
  await page.route('**/*.supabase.co/functions/v1/**', (route) => {
    const url = route.request().url();
    if (url.includes('extract-place')) return servir(route, 'extractPlace', REPONSES.extractPlace);
    if (url.includes('enrich-place')) return servir(route, 'enrichPlace', REPONSES.enrichPlace);
    return route.fulfill(json({ ok: false }));
  });

  return { appels: () => ({ ...appels }) };
}
