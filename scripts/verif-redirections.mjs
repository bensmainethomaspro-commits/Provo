/**
 * Vérifie que `joindre` revalide CHAQUE saut de redirection, pas seulement le
 * premier, et que `lireCorps` s'arrête au plafond au lieu de tout charger.
 *
 * Le module partagé est importé tel quel (`_shared/reseau.ts`, que Node lit
 * en retirant les types) : ni copie ni découpage du source. L'ancienne
 * version découpait `enrich-place` au texte et s'est cassée le jour où le
 * filtre a déménagé dans `_shared`. Seul `fetch` est simulé.
 *
 * Usage :  node scripts/verif-redirections.mjs
 */
import { readFileSync } from 'node:fs';
import { joindre, lireCorps } from '../supabase/functions/_shared/reseau.ts';

/** Un faux serveur : une carte URL → réponse. */
function serveur(routes) {
  const vus = [];
  globalThis.fetch = async (url, init) => {
    vus.push(url);
    if (init?.redirect !== 'manual') throw new Error('redirection laissée à fetch');
    const r = routes[url];
    if (r === 'panne') throw new Error('réseau');
    if (!r) return new Response(null, { status: 404 });
    return new Response(r.status >= 300 && r.status < 400 ? null : 'ok',
      { status: r.status, headers: r.headers || {} });
  };
  return vus;
}

const PUB = 'https://exemple.fr/';
const cas = [
  {
    nom: 'aucune redirection : rend la réponse et l’URL de départ',
    routes: { [PUB]: { status: 200 } },
    attendu: (r) => r?.reponse?.status === 200 && r.urlFinale.toString() === PUB,
  },
  {
    nom: 'redirection publique : suivie, l’URL finale est celle d’arrivée',
    routes: {
      [PUB]: { status: 301, headers: { location: 'https://ailleurs.fr/page' } },
      'https://ailleurs.fr/page': { status: 200 },
    },
    attendu: (r) => r?.reponse?.status === 200 && r.urlFinale.toString() === 'https://ailleurs.fr/page',
  },
  {
    nom: 'redirection vers une adresse interne : REFUSÉE avant d’être jointe',
    routes: {
      [PUB]: { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } },
      'http://169.254.169.254/latest/meta-data/': { status: 200 },
    },
    attendu: (r) => r && r.reponse === null && r.urlFinale.toString() === PUB,
    jamaisJoint: 'http://169.254.169.254/latest/meta-data/',
  },
  {
    nom: 'redirection vers localhost : refusée elle aussi',
    routes: { [PUB]: { status: 307, headers: { location: 'http://127.0.0.1:8000/' } } },
    attendu: (r) => r && r.reponse === null,
    jamaisJoint: 'http://127.0.0.1:8000/',
  },
  {
    nom: 'Location relative : résolue, pas refusée',
    routes: {
      [PUB]: { status: 302, headers: { location: '/fr/horaires' } },
      'https://exemple.fr/fr/horaires': { status: 200 },
    },
    attendu: (r) => r?.reponse?.status === 200 && r.urlFinale.toString() === 'https://exemple.fr/fr/horaires',
  },
  {
    nom: 'redirection sans Location : s’arrête sans jeter',
    routes: { [PUB]: { status: 302 } },
    attendu: (r) => r && r.reponse === null,
  },
  {
    nom: 'panne réseau au 2e saut : garde l’URL atteinte (un lien Maps y porte ses coordonnées)',
    routes: {
      [PUB]: { status: 302, headers: { location: 'https://www.google.com/maps/place/X/@41.9,12.4,17z' } },
      'https://www.google.com/maps/place/X/@41.9,12.4,17z': 'panne',
    },
    attendu: (r) => r && r.reponse === null && r.urlFinale.toString().includes('@41.9,12.4'),
  },
];

let casses = 0;
const note = (ok, nom, detail) => {
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${nom}`);
  if (!ok && detail) console.log(`   ${detail}`);
};

for (const c of cas) {
  const vus = serveur(c.routes);
  let r = null, jete = '';
  try { r = await joindre(PUB, undefined, () => ({})); }
  catch (e) { jete = String(e.message || e); }
  const fuite = c.jamaisJoint && vus.includes(c.jamaisJoint);
  note(!jete && !fuite && c.attendu(r), c.nom,
    jete ? `a jeté : ${jete}` : fuite ? `ADRESSE INTERNE JOINTE : ${c.jamaisJoint}` : `rendu : ${r && r.urlFinale}`);
}

{
  const vus = serveur({});
  const r = await joindre('http://10.0.0.5/tiktok.com', undefined, () => ({}));
  note(r === null && vus.length === 0, 'URL de départ interne : rien n’est joint');
}

// Une chaîne plus longue que la limite ne doit pas boucler indéfiniment.
{
  const routes = {};
  for (let i = 0; i < 20; i++) {
    routes[`https://exemple.fr/${i}`] = { status: 302, headers: { location: `https://exemple.fr/${i + 1}` } };
  }
  const vus = serveur(routes);
  const r = await joindre('https://exemple.fr/0', undefined, () => ({}));
  note(r?.reponse === null && vus.length <= 6, `chaîne sans fin : coupée (${vus.length} requêtes)`);
}

// Les en-têtes se décident à chaque saut (cookie de consentement Google).
{
  const vusEntetes = [];
  serveur({
    'https://maps.app.goo.gl/abc': { status: 302, headers: { location: 'https://www.google.com/maps/place/X' } },
    'https://www.google.com/maps/place/X': { status: 200 },
  });
  const f = globalThis.fetch;
  globalThis.fetch = (u, init) => { vusEntetes.push([u, init.headers]); return f(u, init); };
  await joindre('https://maps.app.goo.gl/abc', undefined, (u) => ({ hote: u.hostname }));
  note(vusEntetes[1]?.[1]?.hote === 'www.google.com', 'en-têtes recalculés pour chaque saut');
}

// lireCorps : un corps sans fin s'arrête au plafond, sans tout charger.
{
  let tires = 0;
  const infini = new ReadableStream({
    pull(c) { tires++; c.enqueue(new Uint8Array(64 * 1024).fill(97)); },
  });
  const t = await lireCorps(new Response(infini), 400_000);
  note(t.length === 400_000 && tires < 20, `corps sans fin : coupé à 400 ko (${tires} morceaux lus)`);
}
{
  const t = await lireCorps(new Response('Café à Lisbonne'), 1000);
  note(t === 'Café à Lisbonne', 'corps court : rendu entier, accents compris');
}

// Garde-fou de source : plus aucune fonction ne laisse fetch suivre seul.
for (const f of ['extract-place', 'enrich-place']) {
  const src = readFileSync(new URL(`../supabase/functions/${f}/index.ts`, import.meta.url), 'utf8');
  note(!/redirect:\s*"follow"/.test(src) && /\bjoindre\(/.test(src),
    `${f} : aucune redirection suivie par fetch, passe par joindre()`);
}

console.log(casses ? `\n${casses} cas cassé(s)` : '\ntous les cas passent\n');
process.exit(casses ? 1 : 0);
