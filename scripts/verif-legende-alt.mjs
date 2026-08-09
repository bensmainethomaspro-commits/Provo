/**
 * Vérifie `legendeDansTexteAlternatif` sur le markdown réellement mesuré.
 *
 * Cette fonction existe en DEUX exemplaires — dans la fonction Edge, qui sert
 * l'app, et dans le canari, qui surveille. Les mêmes cas passent dans les deux :
 * le jour où l'une est corrigée sans l'autre, ce test casse. Et les fonctions
 * sont DÉCOUPÉES dans les vrais fichiers, jamais recopiées ici : une copie de
 * plus finirait par diverger, et le test cesserait de tester quoi que ce soit.
 *
 * Usage :  node scripts/verif-legende-alt.mjs
 */
import { readFileSync } from 'node:fs';

const LEGENDES_GENERIQUES = /TikTok - Make Your Day|Make Your Day/i;
const legendeGenerique = (t) => !t || LEGENDES_GENERIQUES.test(t.trim());

function decouper(src, nom) {
  const debut = src.indexOf(`function ${nom}(`);
  if (debut < 0) throw new Error(`introuvable : ${nom}`);
  let i = src.indexOf('{', debut), p = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') p++;
    else if (src[i] === '}' && --p === 0) return src.slice(debut, i + 1);
  }
  throw new Error(`accolades non refermées : ${nom}`);
}

// Les annotations de type, sans toucher aux objets littéraux (`{ caption: t }`
// doit survivre) ni aux types de retour, qu'on retire à part.
// Le premier `) : … {` d'une fonction découpée est forcément son type de
// retour — remplacement non global, il ne peut donc pas mordre plus loin.
const sansTypes = (code) => code
  .replace(/\)\s*:\s*[^{;=]+\{/, ') {')
  .replace(/(\w+)\s*:\s*(string|number|boolean)\b/g, '$1');

function charger(chemin, noms, principale) {
  const src = readFileSync(new URL(chemin, import.meta.url), 'utf8');
  const code = noms.map(n => sansTypes(decouper(src, n))).join('\n');
  return new Function('legendeGenerique', `${code}; return ${principale};`)(legendeGenerique);
}

const EDGE = '../supabase/functions/extract-place/index.ts';

const IMPLEMENTATIONS = [
  ['fonction Edge', charger(EDGE, ['legendeDansTexteAlternatif'], 'legendeDansTexteAlternatif')],
  ['canari', charger('../scripts/canari-extraction.mjs',
    ['legendeDansTexteAlternatif'], 'legendeDansTexteAlternatif')],
];

// Nommer et situer sont deux questions : la même légende n'y répond pas par la
// même chaîne. Les confondre a produit une fiche « DEOUN » située à 30 km.
const LECTURE_DU_LIEU = [
  ['extractLocationHint', 'trimNoise', 'extractAddressHint'],
  ['extractGeoHint', 'trimNoise', 'extractAddressHint', 'epingleComplete', 'extractLocationHint'],
];
const [nomme, situe] = LECTURE_DU_LIEU.map(([principale, ...reste]) => {
  const src = readFileSync(new URL(EDGE, import.meta.url), 'utf8');
  const prelude = 'const STREET_WORDS = ' + JSON.stringify(
    (src.match(/const STREET_WORDS\s*=\s*([\s\S]*?);/) || [, '""'])[1]
      .replace(/\s*\+\s*/g, '').replace(/"/g, '')) + ';\n'
    + (src.match(/const NOISE_AFTER\s*=\s*[\s\S]*?;/) || [''])[0] + '\n';
  const code = [principale, ...reste].map(n => sansTypes(decouper(src, n))).join('\n');
  return new Function(`${prelude}${code}; return ${principale};`)();
});

const cas = [
  {
    nom: 'post photo — la forme mesurée le 9 août 2026',
    md: 'Title: Avery | Biarritz & Travel on TikTok URL Source: https://www.tiktok.com/@bonjouravery/photo/7485764800912395563 Markdown Content: © 2026 TikTok ![Image 1: 835 Likes, 6 Comments. image posted by  () on : “📍DEOUN | Biarritz, France Your new go-to spot in Biarritz. Grill your own Korean BBQ with fresh ingredients Perfect activity with a group of friends or a fun date!  Address: 9 Rue Harispe 64200 Biarritz, France #biarritzrestaurant #paysbasque #datenight #sudouest #biarritzfood”](https://p16-common-sign.tiktokcdn-us.com/tos-useast5-i-photomode-tx/850d37b~tplv-photomode-image.jpeg?dr=9616)',
    attendu: /^📍DEOUN \| Biarritz, France/,
    image: /tplv-photomode-image/,
  },
  {
    nom: 'post vidéo — attribution « TikTok video from »',
    md: '![Image 1: 1.2M Likes, 3400 Comments. TikTok video from Avery (@bonjouravery). 📍Bouillon Chartier, Paris — le meilleur rapport qualité prix #paris](https://cdn/x.jpeg)',
    attendu: /^📍Bouillon Chartier, Paris/,
  },
  {
    nom: 'texte alternatif sans légende — ne rend rien',
    md: '![Image 1: 835 Likes, 6 Comments.](https://cdn/x.jpeg) ![logo](https://cdn/l.png)',
    attendu: null,
  },
  {
    nom: 'texte générique — refusé, pour ne pas couper les échelons suivants',
    md: '![Image 1: 2 Likes, 0 Comments. image posted by  () on : “TikTok - Make Your Day”](https://cdn/x.jpeg)',
    attendu: null,
  },
  {
    nom: 'aucune image — rend null sans jeter',
    md: 'Title: TikTok Log in Search',
    attendu: null,
  },
];

let casses = 0;
for (const [ou, lire] of IMPLEMENTATIONS) {
  console.log(`\n■ ${ou}`);
  for (const c of cas) {
    let r, jete = '';
    try { r = lire(c.md); } catch (e) { jete = String(e.message || e); }
    const ok = !jete && (c.attendu === null
      ? r === null
      : Boolean(r && c.attendu.test(r.caption) && (!c.image || c.image.test(r.image))));
    if (!ok) casses++;
    console.log(`  ${ok ? '✓' : '✗'} ${c.nom}`);
    if (jete) console.log(`     a jeté : ${jete}`);
    else if (!ok) console.log(`     rendu : ${JSON.stringify(r)}`);
    else if (r) console.log(`     → « ${r.caption.slice(0, 58)}… »`);
  }
}
const LEGENDE_DEOUN =
  '📍DEOUN | Biarritz, France Your new go-to spot in Biarritz. Grill your own '
  + 'Korean BBQ with fresh ingredients Perfect activity with a group of friends '
  + 'or a fun date!  Address: 9 Rue Harispe 64200 Biarritz, France '
  + '#biarritzrestaurant #paysbasque #datenight #sudouest #biarritzfood';

const lieux = [
  {
    nom: 'la légende mesurée : nommée par l’épingle, située par l’adresse',
    legende: LEGENDE_DEOUN,
    nomme: 'DEOUN',
    situe: /^9 Rue Harispe 64200 Biarritz/,
  },
  {
    nom: 'épingle seule : la ville reste dans la requête de géocodage',
    legende: '📍Bouillon Chartier | Paris, France — le meilleur rapport qualité prix',
    nomme: 'Bouillon Chartier',
    situe: /^Bouillon Chartier, Paris, France/,
  },
  {
    nom: 'adresse seule : elle nomme faute de mieux, et elle situe',
    legende: 'Le meilleur café du quartier, 12 rue de Rivoli, Paris',
    nomme: /^12 rue de Rivoli/,
    situe: /^12 rue de Rivoli/,
  },
];

console.log('\n■ nommer et situer');
for (const c of lieux) {
  const n = nomme(c.legende) || '';
  const s = situe(c.legende) || '';
  const attendu = (v, a) => (a instanceof RegExp ? a.test(v) : v === a);
  const ok = attendu(n, c.nomme) && attendu(s, c.situe);
  if (!ok) casses++;
  console.log(`  ${ok ? '✓' : '✗'} ${c.nom}`);
  console.log(`     nomme « ${n} »  ·  situe « ${s} »`);
}

const total = cas.length * IMPLEMENTATIONS.length + lieux.length;
console.log(casses
  ? `\n${casses} cas cassé(s) sur ${total}`
  : `\nles ${total} cas passent — les deux exemplaires sont d'accord\n`);
process.exit(casses ? 1 : 0);
