// Sonde : les deux portes que Google laisse ouvertes à un serveur sont-elles
// toujours ouvertes ?
//
// Le 11 novembre 2026, un lien `share.google` vers un restaurant de Rome, collé
// dans un voyage à Biarritz, est ressorti en fiche nue. La page Google exige
// JavaScript : téléchargée par la fonction, elle ne porte rien. Deux choses, en
// revanche, sont servies telles quelles aux robots qui déplient les liens dans
// les messageries, et la fonction `extract-place` s'en sert :
//
//   1 · l'aperçu du lien de partage — « Nom · Ville, Région, Pays » et
//       « 4.8 ⭐ · Restaurant » ;
//   2 · la vignette d'une recherche Google Maps par le nom, centrée sur le lieu
//       quand la recherche en désigne UN.
//
// Ce ne sont pas des API : rien ne garantit qu'elles durent. Cette sonde les
// relit avec les MÊMES lecteurs que la fonction (`_shared/lecture-lien.ts`) et
// dit ce qu'ils en tirent. Le jour où l'une se ferme, c'est ici que ça se voit,
// pas dans une fiche vide sur le téléphone de quelqu'un.
//
// (Écarté après mesure : le lecteur tiers r.jina.ai rendait le panneau entier
// à 16 h 27 et le captcha de Google à 21 h 16. On ne bâtit rien dessus.)
//
// Usage :  node scripts/diag-lien-google.mjs [lien]

import {
  categorieDuGenre, communeEtPays, lireApercuGoogle, lirePointMaps,
} from '../supabase/functions/_shared/lecture-lien.ts';
import { jeuDeCaracteres } from '../supabase/functions/_shared/reseau.ts';

const LIEN = process.argv[2] || 'https://share.google/y4QMh42nQx6DiSBfZ';

const UA_ROBOT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const TEMOIN = 'CONSENT=YES+cb.20240101-00-p0.fr+FX+000; '
  + 'SOCS=CAISHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmZyIAEaBgiA0K2tBg';

const titre = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const court = (s, n = 150) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const entetes = (u) => ({
  'User-Agent': UA_ROBOT,
  'Accept-Language': 'fr,en;q=0.8',
  ...(/google\.|goo\.gl/i.test(u.hostname) ? { Cookie: TEMOIN } : {}),
});

/** Suit les redirections à la main, comme `joindre`, et décode comme `lireCorps`. */
async function commeUnRobot(url, max = 8) {
  const sauts = [];
  let courant = url;
  try {
    for (let i = 0; i < max; i++) {
      const r = await fetch(courant, { redirect: 'manual', headers: entetes(new URL(courant)), signal: AbortSignal.timeout(20000) });
      const loc = r.headers.get('location');
      sauts.push(r.status);
      if (r.status >= 300 && r.status < 400 && loc) {
        await r.body?.cancel().catch(() => {});
        courant = new URL(loc, courant).toString();
        continue;
      }
      const octets = new Uint8Array(await r.arrayBuffer());
      const jeu = jeuDeCaracteres(r.headers.get('content-type'), octets);
      return { sauts, finalUrl: courant, status: r.status, jeu, html: new TextDecoder(jeu).decode(octets) };
    }
  } catch (e) {
    return { sauts, finalUrl: courant, status: 0, html: '', erreur: String(e).slice(0, 120) };
  }
  return { sauts, finalUrl: courant, status: 0, html: '', erreur: 'trop de sauts' };
}
const refuse = (c) => c.status === 429 || /\/sorry\//.test(c.finalUrl);

let ouvertes = 0, fermees = 0;
const bilan = (ok, quoi) => { if (ok) ouvertes++; else fermees++; console.log(`    ${ok ? '✅' : '❌'} ${quoi}`); };

// ── 1 · L'aperçu du lien de partage ──────────────────────────────────────────
titre(`1 · L'APERÇU DU LIEN DE PARTAGE  ${LIEN}`);
{
  const c = await commeUnRobot(LIEN);
  console.log(`    ${c.sauts.join(' → ')} · ${c.html.length} o · ${c.jeu || '—'} · ${court(c.finalUrl, 90)}${c.erreur ? ` · ${c.erreur}` : ''}`);
  if (refuse(c)) console.log('    Google a répondu par son captcha (429) à cette adresse IP.');
  const a = lireApercuGoogle(c.html);
  console.log(`    lu : ${a ? JSON.stringify(a) : 'rien'}`);
  if (a) console.log(`    → cherché autour de « ${communeEtPays(a.localite) || '—'} », catégorie « ${categorieDuGenre(a.genre) || '—'} »`);
  bilan(Boolean(a?.nom && a?.localite), 'le lien dit le nom du lieu et où il est');
}
await pause(2500);

// ── 2 · Le point d'un lieu, par son nom ──────────────────────────────────────
titre('2 · LE POINT D\'UN LIEU PAR SON NOM (vignette Google Maps servie aux robots)');
// [ce qu'on attend, la recherche, le point attendu à 1 km près | null = aucun point ne doit sortir]
const NOMS = [
  ['un restaurant, nom seul', 'ADEVA Cucina Moderna', [41.9021, 12.4847]],
  ['un restaurant, avec sa ville', 'ADEVA Cucina Moderna, Rome, Italie', [41.9021, 12.4847]],
  ['dit en anglais', 'Vienna state opera', [48.2034, 16.3692]],
  ['dit en français, avec le voyage', 'Palais du Belvedere, Vienne Autriche', [48.1915, 16.3809]],
  ['germanisé à la main', 'Schönbrunner Palais, Vienne Autriche', [48.1858, 16.3128]],
  ['absent de la carte ouverte', 'Agapii Mou, Athènes', [37.9847, 23.7393]],
  ['homonymes partout', 'Café Central', null],
  ['homonyme, avec le voyage', 'Café Central, Vienne Autriche', [48.2104, 16.3654]],
  ['n\'existe pas', 'zzqxj plouf trattoria inexistante', null],
  // Ce qui décide de la confiance à lui faire : quand le lieu n'est PAS dans
  // la ville qu'on lui donne, Google rend-il le bon lieu, rien, ou un voisin
  // qui ressemble ?
  ['MAUVAISE ville (Rome → Biarritz)', 'ADEVA Cucina Moderna, Biarritz', 'voir'],
  ['MAUVAISE ville (Athènes → Biarritz)', 'Agapii Mou, Biarritz', 'voir'],
  ['MAUVAISE ville (Vienne → Biarritz)', 'Vienna state opera, Biarritz', 'voir'],
  ['un mot en commun, sur place', 'Cucina Moderna, Biarritz', 'voir'],
];
const km = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2
    + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const meta = (html, prop) => (html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
  || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${prop}["']`, 'i')) || [])[1] || '';

for (const [quoi, nom, attendu] of NOMS) {
  const u = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nom).replace(/%20/g, '+')}`;
  const c = await commeUnRobot(u);
  const p = lirePointMaps(c.html);
  const image = meta(c.html, 'og:image').replace(/&amp;/g, '&');
  console.log(`\n  ■ ${quoi.padEnd(34)} « ${nom} »`);
  console.log(`    ${c.sauts.join(' → ')} · ${c.html.length} o${refuse(c) ? ' · CAPTCHA' : ''}${c.erreur ? ` · ${c.erreur}` : ''}`);
  console.log(`    og:title « ${court(meta(c.html, 'og:title'), 90)} » · og:description « ${court(meta(c.html, 'og:description'), 90)} »`);
  console.log(`    vignette : ${court(image.replace(/^.*staticmap\?/, '').replace(/&(key|signature|client)=[^&]*/g, ''), 170) || '—'}`);
  console.log(`    lu : ${p ? `${p.lat}, ${p.lon}` : 'aucun point'}`);
  await pause(1800);
  if (attendu === 'voir') continue;
  if (attendu) bilan(Boolean(p) && km([p.lat, p.lon], attendu) < 1, `le point du lieu, à ${p ? Math.round(km([p.lat, p.lon], attendu) * 1000) : '—'} m de celui attendu`);
  else bilan(!p, 'aucun point : la recherche ne désigne pas UN lieu');
}

titre(`BILAN : ${ouvertes} contrôles justes, ${fermees} faux`);
if (fermees) console.log('  Une porte s\'est refermée, ou Google a servi son captcha à cet exécuteur.\n  La fonction retombe alors sur la carte ouverte seule : voir `geocodeurs` dans sa réponse.');
