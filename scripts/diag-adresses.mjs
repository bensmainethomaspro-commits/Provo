// Banc de mesure : les adresses et les noms HORS de France.
//
// Signalé à l'usage : « souvent les lieux de voyage sont hors de France, pour
// l'ajout des adresses il faut améliorer ». Avant de changer quoi que ce soit,
// on mesure les stratégies possibles sur des saisies telles qu'un voyageur
// français les tape à l'étranger : sans ville, sans accent, abrégées, à moitié
// tapées, à l'ordre français.
//
// Le bac à sable ne joint aucun géocodeur : ce script tourne sur un exécuteur
// GitHub (`diagnose-places.yml`). Il ne modifie rien, il mesure et il imprime.
//
//   node scripts/diag-adresses.mjs

const UA = 'Provo-Travel-App/1.0 (diagnostic; https://github.com/bensmainethomaspro-commits/Provo)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const VILLES = {
  athenes:   { lat: 37.9838, lon: 23.7275, pays: 'gr', nom: 'Athènes' },
  lisbonne:  { lat: 38.7223, lon: -9.1393, pays: 'pt', nom: 'Lisbonne' },
  rome:      { lat: 41.9028, lon: 12.4964, pays: 'it', nom: 'Rome' },
  palerme:   { lat: 38.1157, lon: 13.3615, pays: 'it', nom: 'Palerme' },
  vienne:    { lat: 48.2082, lon: 16.3738, pays: 'at', nom: 'Vienne' },
  barcelone: { lat: 41.3874, lon: 2.1686,  pays: 'es', nom: 'Barcelone' },
  madrid:    { lat: 40.4168, lon: -3.7038, pays: 'es', nom: 'Madrid' },
  berlin:    { lat: 52.5200, lon: 13.4050, pays: 'de', nom: 'Berlin' },
  budapest:  { lat: 47.4979, lon: 19.0402, pays: 'hu', nom: 'Budapest' },
  tokyo:     { lat: 35.6762, lon: 139.6503, pays: 'jp', nom: 'Tokyo' },
  istanbul:  { lat: 41.0082, lon: 28.9784, pays: 'tr', nom: 'Istanbul' },
  newyork:   { lat: 40.7128, lon: -74.0060, pays: 'us', nom: 'New York' },
};

// [saisie, ville du voyage, indice attendu dans le résultat]
const ADRESSES = [
  ['Ermou 10', 'athenes', 'ermou'],
  ['Skoufa 55', 'athenes', 'skoufa'],
  ['Adrianou 23', 'athenes', 'adrian'],
  ['Mitropoleos 3', 'athenes', 'mitropol'],
  ['Rua Augusta 100', 'lisbonne', 'augusta'],
  ['rua da rosa 50', 'lisbonne', 'rosa'],
  ['Largo do Carmo', 'lisbonne', 'carmo'],
  ['Via del Corso 12', 'rome', 'corso'],
  ['Via dei Coronari 20', 'rome', 'coronari'],
  ['Via Roma 12', 'palerme', 'roma'],
  ['Kärntner Straße 38', 'vienne', 'karntner'],
  ['Karntner Strasse 38', 'vienne', 'karntner'],
  ['Mariahilfer Str. 50', 'vienne', 'mariahilfer'],
  ['Rennweg 8', 'vienne', 'rennweg'],
  ['Carrer de Verdi 10', 'barcelone', 'verdi'],
  ['Passeig de Gracia 43', 'barcelone', 'gracia'],
  ['Calle de Postas 5', 'madrid', 'postas'],
  ['Oranienstr. 25', 'berlin', 'oranien'],
  ['Torstrasse 1', 'berlin', 'torstra'],
  ['Andrássy út 60', 'budapest', 'andr'],
  ['Andrassy ut 60', 'budapest', 'andr'],
  ['Istiklal Caddesi 100', 'istanbul', 'stiklal'],
  ['350 5th Ave', 'newyork', '5th'],
];

// Saisies à moitié tapées : c'est ce que voit la recherche « à la frappe ».
const PARTIELLES = [
  ['Rua Aug', 'lisbonne', 'augusta'],
  ['Kärntner Str', 'vienne', 'karntner'],
  ['Via dei Coron', 'rome', 'coronari'],
  ['Skouf', 'athenes', 'skoufa'],
  ['Andrassy', 'budapest', 'andr'],
  ['Torstr', 'berlin', 'torstra'],
];

// Des NOMS seuls, tels qu'un lien de site ou une légende les donne.
const NOMS = [
  ['Café Central', 'vienne', 'central'],
  ['Café Sacher', 'vienne', 'sacher'],
  ['Time Out Market', 'lisbonne', 'time out'],
  ['Pastéis de Belém', 'lisbonne', 'belem'],
  ['Mercado de San Miguel', 'madrid', 'miguel'],
  ['Bar Ramón', 'barcelone', 'ram'],
  ['Da Enzo al 29', 'rome', 'enzo'],
  ['Szimpla Kert', 'budapest', 'szimpla'],
  ['Mustafa\'s Gemüse Kebap', 'berlin', 'mustafa'],
  ['Katz\'s Delicatessen', 'newyork', 'katz'],
  ['Little Kook', 'athenes', 'kook'],
  ['Karaköy Güllüoğlu', 'istanbul', 'gull'],
];

const norm = s => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

function km(a, b) {
  const R = 6371, r = d => d * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2
    + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function getJson(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'fr' } });
    if (!r.ok) return { erreur: r.status };
    return await r.json();
  } catch (e) {
    return { erreur: e.name };
  } finally { clearTimeout(t); }
}

// Nominatim tolère une requête par seconde : on espace TOUTES les requêtes.
let dernier = 0;
async function nominatim(q, { ancre, pays, ville } = {}) {
  const attente = 1100 - (Date.now() - dernier);
  if (attente > 0) await sleep(attente);
  dernier = Date.now();
  let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(ville ? `${q}, ${ville}` : q)}`
    + '&format=json&addressdetails=1&limit=5';
  if (ancre) url += `&viewbox=${ancre.lon - 0.7},${ancre.lat + 0.7},${ancre.lon + 0.7},${ancre.lat - 0.7}`;
  if (pays) url += `&countrycodes=${pays}`;
  const d = await getJson(url);
  if (!Array.isArray(d)) return { erreur: d.erreur };
  return { liste: d.map(p => ({ texte: `${p.name || ''} ${p.display_name || ''}`, lat: +p.lat, lon: +p.lon })) };
}

async function photon(q, { ancre } = {}) {
  let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=fr`;
  if (ancre) url += `&lat=${ancre.lat}&lon=${ancre.lon}`;
  const d = await getJson(url);
  if (!d?.features) return { erreur: d?.erreur || 'forme' };
  return {
    liste: d.features.map(f => {
      const p = f.properties || {};
      return {
        texte: [p.name, p.street, p.housenumber, p.city, p.country].filter(Boolean).join(' '),
        lat: f.geometry?.coordinates?.[1], lon: f.geometry?.coordinates?.[0],
      };
    }),
  };
}

// Juste = le PREMIER résultat porte l'indice et tombe à moins de 40 km.
function juge(rep, indice, ancre) {
  if (rep.erreur) return `ERR ${rep.erreur}`;
  const r = rep.liste?.[0];
  if (!r) return 'rien';
  const d = km(ancre, r);
  if (d > 40) return `loin ${Math.round(d)} km`;
  if (!norm(r.texte).includes(norm(indice))) return 'autre';
  return 'OK';
}

const STRATEGIES = {
  // Ce que fait l'app aujourd'hui : Nominatim orienté vers la destination,
  // Photon seulement si Nominatim ne rend rien.
  actuelle: async (q, v) => {
    const n = await nominatim(q, { ancre: v });
    if (n.liste?.length) return n;
    return photon(q, { ancre: v });
  },
  'nominatim+pays': (q, v) => nominatim(q, { ancre: v, pays: v.pays }),
  photon: (q, v) => photon(q, { ancre: v }),
  // Ce que ferait un serveur qui ignore la destination (extract-place).
  'nom seul': (q) => nominatim(q),
  'nom+ville': (q, v) => nominatim(q, { ville: v.nom }),
};

async function banc(titre, jeu, strategies) {
  console.log(`\n══ ${titre} (${jeu.length}) ══`);
  const scores = Object.fromEntries(strategies.map(s => [s, 0]));
  for (const [q, cle, indice] of jeu) {
    const v = VILLES[cle];
    const ligne = [];
    for (const s of strategies) {
      const verdict = juge(await STRATEGIES[s](q, v), indice, v);
      if (verdict === 'OK') scores[s]++;
      ligne.push(`${s}: ${verdict}`);
    }
    console.log(`  ${q.padEnd(26)} [${v.nom}]  ${ligne.join(' · ')}`);
  }
  console.log('  ── total ──', Object.entries(scores).map(([s, n]) => `${s} ${n}/${jeu.length}`).join(' · '));
}

await banc('Adresses complètes à l\'étranger', ADRESSES, ['actuelle', 'nominatim+pays', 'photon']);
await banc('Adresses à moitié tapées', PARTIELLES, ['actuelle', 'nominatim+pays', 'photon']);
await banc('Noms seuls (liens de sites, légendes)', NOMS, ['nom seul', 'nom+ville', 'nominatim+pays', 'photon']);
