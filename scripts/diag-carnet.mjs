// Banc de mesure : de quoi une fiche « carnet » se nourrit-elle, gratuitement ?
//
// Demandé le 14 novembre 2026, carnet de Venise à l'appui : une page par lieu,
// avec une grande photo, une seconde, deux lignes de présentation, horaires,
// prix et un « bon à savoir ». La forme se dessine sans peine ; la question
// est le CONTENU. Avant de promettre une fiche qui ressemble au carnet, on
// mesure ce que les sources libres donnent pour les lieux de ce carnet-là :
//
//   · la carte ouverte (Nominatim) : le lieu, ses horaires, son site, et les
//     faits dont on tire un « bon à savoir » (réservation, espèces, terrasse…) ;
//   · Wikidata / Wikipédia : une photo, deux phrases en français ;
//   · Wikimedia Commons : d'autres photos du lieu, ou prises à deux pas ;
//   · le site du lieu : l'image et la description qu'il publie de lui-même.
//
// Le bac à sable ne joint aucun de ces services : ce script tourne sur un
// exécuteur GitHub (`diagnose-carnet.yml`). Il ne modifie rien, il imprime.
//
//   node scripts/diag-carnet.mjs

const UA = 'Provo-Travel-App/1.0 (diagnostic; https://github.com/bensmainethomaspro-commits/Provo)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Les noms tels que le carnet les écrit — c'est ainsi qu'on les taperait.
const VISITES = [
  'Basilique Saint-Marc', 'Palais des Doges', 'Campanile de Saint-Marc', 'Scala Contarini del Bovolo',
  'Théâtre La Fenice', 'Pont du Rialto', 'Marché du Rialto', 'Scuola Grande di San Rocco',
  'Galerie dell\'Accademia', 'Chiesa di San Pantalon', 'Murano', 'Burano', 'Torcello',
];
const TABLES = [
  'Osteria ai Promessi Sposi', 'Vino Vero', 'Al Timon', 'Osteria da Alberto', 'Mezzopieno',
  'Ca\' d\'Oro alla Vedova', 'Caffè Florian', 'Gallonetto', 'Al Gobbo di Rialto', 'Antico Forno',
  'Farini', 'Cantine del Vino già Schiavi', 'Taverna San Trovaso', 'Margaret Duchamp', 'Ristorante La Fornace',
];
// La lagune, de Venise à Torcello : la recherche reste dans le voyage.
const CADRE = '12.25,45.53,12.47,45.39';

async function json(url, delai = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), delai);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'fr' } });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}
async function page(url, delai = 9000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), delai);
  try {
    const r = await fetch(url, { signal: c.signal, redirect: 'follow',
      headers: { 'User-Agent': 'facebookexternalhit/1.1', 'Accept-Language': 'fr,en;q=0.8' } });
    return r.ok ? (await r.text()).slice(0, 400_000) : '';
  } catch { return ''; } finally { clearTimeout(t); }
}

// Ce que la carte ouverte range sous « quartier » : le champ change d'une ville
// à l'autre (sestiere, Bezirk, arrondissement, rione, barri). L'app retient
// le premier présent de cette liste (`quartierDe`, src/utils/enrich.js).
const ORDRE_QUARTIER = ['quarter', 'suburb', 'city_district', 'neighbourhood', 'borough'];
function champsQuartier(a = {}) {
  const vus = ORDRE_QUARTIER.filter(k => a[k]).map(k => `${k}=${a[k]}`);
  const retenu = ORDRE_QUARTIER.map(k => a[k]).find(Boolean) || '—';
  return `« ${retenu} »  (${vus.join(' · ') || 'aucun champ'})`;
}

// Les faits de la carte ouverte dont on sait écrire un « bon à savoir ».
const FAITS = ['reservation', 'payment:cash', 'payment:credit_cards', 'payment:cards', 'outdoor_seating', 'takeaway',
  'wheelchair', 'fee', 'charge', 'dress_code', 'diet:vegetarian', 'diet:vegan', 'diet:gluten_free', 'toilets',
  'internet_access', 'smoking', 'capacity', 'min_age', 'guided_tours', 'tickets:public_transport'];

async function mesurer(nom) {
  const m = { nom, trouve: '', horaires: false, site: '', faits: [], photoWiki: false, texteFr: 0, texteAutre: '',
    commonsLieu: 0, commonsAutour: 0, imageSite: false, texteSite: 0 };

  const l = await json(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(nom)}`
    + `&viewbox=${CADRE}&bounded=1&format=json&limit=1&extratags=1&namedetails=1&addressdetails=1`);
  await sleep(1100);
  const p = l?.[0];
  if (!p) return m;
  const ex = p.extratags || {};
  m.trouve = p.namedetails?.name || p.name || p.display_name.split(',')[0];
  m.quartiers = champsQuartier(p.address);
  m.horaires = Boolean(ex.opening_hours);
  m.site = ex.website || ex['contact:website'] || ex.url || '';
  m.faits = FAITS.filter(k => ex[k]);

  // Wikidata : la photo choisie (P18), la catégorie Commons (P373), la page en français.
  let q = ex.wikidata || '';
  if (!q && ex.wikipedia) {
    const [lg, ...reste] = ex.wikipedia.split(':');
    const w = await json(`https://${lg}.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item`
      + `&redirects=1&format=json&titles=${encodeURIComponent(reste.join(':'))}`);
    q = Object.values(w?.query?.pages || {})[0]?.pageprops?.wikibase_item || '';
  }
  if (q) {
    const d = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${q}&props=claims|sitelinks`
      + '&sitefilter=frwiki|itwiki|enwiki&format=json');
    const e = d?.entities?.[q];
    m.photoWiki = Boolean(e?.claims?.P18?.length);
    const categorie = e?.claims?.P373?.[0]?.mainsnak?.datavalue?.value;
    const fr = e?.sitelinks?.frwiki?.title;
    if (fr) {
      const s = await json(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(fr)}`);
      m.texteFr = (s?.extract || '').length;
      m.photoWiki = m.photoWiki || Boolean(s?.thumbnail?.source);
    } else {
      m.texteAutre = e?.sitelinks?.itwiki ? 'it' : e?.sitelinks?.enwiki ? 'en' : '';
    }
    if (categorie) {
      const cm = await json('https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtype=file'
        + `&cmlimit=50&format=json&cmtitle=${encodeURIComponent(`Category:${categorie}`)}`);
      m.commonsLieu = (cm?.query?.categorymembers || []).filter(f => /\.(jpe?g|png|webp)$/i.test(f.title)).length;
    }
  }

  // Les photos libres prises à moins de 80 m : « la rue, à deux pas ».
  const g = await json('https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gsnamespace=6&gslimit=50'
    + `&gsradius=80&format=json&gscoord=${p.lat}%7C${p.lon}`);
  m.commonsAutour = (g?.query?.geosearch || []).filter(f => /\.(jpe?g|png|webp)$/i.test(f.title)).length;

  // Ce que le site dit de lui-même.
  if (m.site) {
    const h = await page(/^https?:/i.test(m.site) ? m.site : `https://${m.site}`);
    m.imageSite = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i.test(h);
    const desc = h.match(/<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']{20,400})["']/i)
      || h.match(/"description"\s*:\s*"([^"]{20,400})"/);
    m.texteSite = desc ? desc[1].length : 0;
  }
  return m;
}

const oui = b => (b ? '✓' : '·');
function ligne(m) {
  if (!m.trouve) return `  ✗ ${m.nom.padEnd(30)} introuvable sur la carte ouverte`;
  const texte = m.texteFr ? `fr ${String(m.texteFr).padStart(3)} c` : m.texteAutre ? `(${m.texteAutre}) ` : m.texteSite ? `site ${m.texteSite} c` : '—';
  return `  ${m.photoWiki || m.imageSite ? '✓' : '✗'} ${m.nom.slice(0, 30).padEnd(30)} « ${m.trouve.slice(0, 26)} »\n`
    + `      quartier : ${m.quartiers}\n`
    + `      photo wiki ${oui(m.photoWiki)} · Commons du lieu ${String(m.commonsLieu).padStart(2)} · à 80 m ${String(m.commonsAutour).padStart(2)}`
    + ` · image du site ${oui(m.imageSite)} | texte ${texte} | horaires ${oui(m.horaires)} | faits : ${m.faits.join(', ') || '—'}`;
}
function bilan(titre, ms) {
  const n = ms.length, c = f => ms.filter(f).length;
  console.log(`\n── ${titre} : ${n} lieux ─────────────────────────────────────────────`);
  console.log(`   trouvés sur la carte ouverte          : ${c(m => m.trouve)}/${n}`);
  console.log(`   une photo du lieu (wiki ou son site)  : ${c(m => m.photoWiki || m.imageSite)}/${n}  (wiki ${c(m => m.photoWiki)}, site ${c(m => m.imageSite)})`);
  console.log(`   une SECONDE photo (Commons du lieu ≥2, ou ≥1 prise à 80 m) : ${c(m => m.commonsLieu >= 2 || m.commonsAutour >= 1)}/${n}`);
  console.log(`   deux phrases en français (Wikipédia)  : ${c(m => m.texteFr >= 60)}/${n}`);
  console.log(`   à défaut, un texte publié par le site : ${c(m => m.texteFr < 60 && m.texteSite >= 20)}/${n}`);
  console.log(`   aucun texte du tout                   : ${c(m => m.texteFr < 60 && m.texteSite < 20)}/${n}`);
  console.log(`   horaires                              : ${c(m => m.horaires)}/${n}`);
  console.log(`   au moins un fait pour « bon à savoir » : ${c(m => m.faits.length)}/${n}`);
}

// D'autres villes, pour le seul quartier : ce que « quartier » veut dire ailleurs.
const AILLEURS = [
  ['Café Central', 'Wien'], ['Kunsthistorisches Museum', 'Wien'], ['Naschmarkt', 'Wien'],
  ['Musée du Louvre', 'Paris'], ['Le Comptoir du Relais', 'Paris'], ['Sacré-Cœur', 'Paris'],
  ['Da Enzo al 29', 'Roma'], ['Fontana di Trevi', 'Roma'], ['Pantheon', 'Roma'],
  ['Sagrada Família', 'Barcelona'], ['Bar del Pla', 'Barcelona'],
  ['Pastéis de Belém', 'Lisboa'], ['Time Out Market Lisboa', 'Lisboa'],
];
console.log('\n════ QUARTIER, AILLEURS ════');
for (const [nom, ville] of AILLEURS) {
  const l = await json(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${nom}, ${ville}`)}`
    + '&format=json&limit=1&addressdetails=1');
  await sleep(1100);
  const ph = await json(`https://photon.komoot.io/api/?q=${encodeURIComponent(`${nom} ${ville}`)}&limit=1&lang=fr`);
  const q = ph?.features?.[0]?.properties || {};
  console.log(`  ${`${nom} (${ville})`.padEnd(36)} ${l?.[0] ? champsQuartier(l[0].address) : 'introuvable'}`
    + `\n      photon : district=${q.district || '—'} · locality=${q.locality || '—'}`);
}

for (const [titre, noms] of [['VISITES', VISITES], ['RESTAURANTS, CAFÉS, BARS', TABLES]]) {
  console.log(`\n════ ${titre} ════`);
  const ms = [];
  for (const nom of noms) {
    const m = await mesurer(nom);
    ms.push(m);
    console.log(ligne(m));
  }
  bilan(titre, ms);
}
