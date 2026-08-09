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

function charger(chemin) {
  const src = readFileSync(new URL(chemin, import.meta.url), 'utf8');
  // Retirer les seules annotations de type présentes, sans toucher aux objets
  // littéraux (`{ caption: t }` doit survivre).
  const code = decouper(src, 'legendeDansTexteAlternatif')
    .replace(/(\w+)\s*:\s*(string|number|boolean)\b/g, '$1');
  return new Function(
    'legendeGenerique', `${code}; return legendeDansTexteAlternatif;`)(legendeGenerique);
}

const IMPLEMENTATIONS = [
  ['fonction Edge', charger('../supabase/functions/extract-place/index.ts')],
  ['canari', charger('../scripts/canari-extraction.mjs')],
];

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
const total = cas.length * IMPLEMENTATIONS.length;
console.log(casses
  ? `\n${casses} cas cassé(s) sur ${total}`
  : `\nles ${total} cas passent — les deux exemplaires sont d'accord\n`);
process.exit(casses ? 1 : 0);
