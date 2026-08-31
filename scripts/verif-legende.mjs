/**
 * Vérifie la lecture d'une légende de réseau social SANS modèle payant.
 *
 * `extract-place` appelait le modèle pour transformer une légende en titre,
 * catégorie et lieu. Les légendes de voyage suivent pourtant des conventions
 * solides — une épingle 📍 devant chaque adresse, des mots-dièse qui disent la
 * nature du lieu, une liste quand il y en a plusieurs — et ce sont exactement
 * les conventions que des règles savent lire.
 *
 * Ce qui se vérifie ici :
 *
 *   1. UN TITRE N'EST PAS UNE PHRASE. « Le meilleur café de Vienne » est un
 *      avis, pas un nom de lieu : mieux vaut rendre la fiche au nom du compte
 *      et laisser corriger que poser un faux nom — une fiche qui porte un faux
 *      nom, on ne la vérifie plus.
 *   2. Une légende qui cite plusieurs lieux les rend TOUS. « 6 spots à
 *      Lisbonne » n'en donnait qu'un ; les cinq autres étaient lus et perdus.
 *   3. Ce qui n'est pas lu reste vide.
 *
 * Les fonctions sont découpées dans la fonction Edge, jamais recopiées.
 *
 * Usage :  node scripts/verif-legende.mjs
 */
import { readFileSync } from 'node:fs';
import { decouper } from './ts-sans-types.mjs';

const src = readFileSync(
  new URL('../supabase/functions/extract-place/index.ts', import.meta.url), 'utf8');
// Tout le bloc d'aides à la lecture, de la classification par mots-dièse
// jusqu'à la fin de `captionLooksLikeSentence`.
const bloc = decouper(src, 'function categoryFromHashtags', 'function hashtagCandidates');

const M = new Function(`${bloc}
  return { lireLegende, cleanTitle, categoryFromHashtags, extractGeoHint,
           captionLooksLikeSentence };`)();

// ── 1 · Un titre n'est pas une phrase ───────────────────────────────────────
const titres = [
  ['📍 Bouillon Chartier, Paris\n#resto #paris', 'Bouillon Chartier, Paris',
    "l'épingle est écrite POUR être lue comme un nom"],
  ['Le meilleur café de Vienne, à ne pas rater 😍', null,
    'un avis en prose ne nomme rien : on rend la main plutôt qu’un faux nom'],
  ['📍DEOUN | Rue Harispe, Biarritz', 'DEOUN, Rue Harispe, Biarritz',
    'la barre verticale sépare deux morceaux d’une même adresse'],
  ['Café Central\nOuvert tous les jours', 'Café Central',
    'un nom court en tête de légende, sans épingle'],
  ['', null, 'rien du tout'],
  ['   \n  ', null, 'des espaces'],
];

let casses = 0;
for (const [legende, attendu, quoi] of titres) {
  const r = M.lireLegende(legende);
  const rendu = r?.title ?? null;
  const ok = rendu === attendu;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${JSON.stringify(legende.slice(0, 34))} → ${attendu ?? '(rien)'}`);
  console.log(`   ${quoi}`);
  if (!ok) console.log(`   rendu : ${rendu ?? '(rien)'}`);
}

// ── 2 · Plusieurs lieux dans une même légende ───────────────────────────────
{
  const legende = `6 spots à Lisbonne à ne pas manquer #lisbonne #food
📍 Time Out Market
📍 Pastéis de Belém
📍 A Cevicheria`;
  const r = M.lireLegende(legende);
  const noms = (r?.lieux || []).map((l) => l.title);
  const ok = noms.length === 3 && noms[0] === 'Time Out Market'
    && noms[2] === 'A Cevicheria' && r.title === 'Time Out Market';
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} trois épingles → trois lieux, le premier en tête`);
  if (!ok) console.log(`   rendu : ${JSON.stringify(noms)} · titre ${r?.title}`);
}
{
  const r = M.lireLegende('📍 Café Central\n📍 Café Central\nle même deux fois');
  const ok = (r?.lieux || []).length === 1;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} deux fois la même épingle ne fait qu'un lieu`);
  if (!ok) console.log(`   rendu : ${JSON.stringify(r?.lieux)}`);
}

// ── 3 · La catégorie vient des mots-dièse, jamais d'une devinette ───────────
const categories = [
  ['📍 Figlmüller #resto #vienne', 'resto', 'un mot-dièse explicite'],
  ['📍 Kunsthistorisches Museum #museum', 'visite', 'un musée'],
  ['📍 Prater #fun', 'fun', 'un parc'],
  ['📍 Un lieu sans mot-dièse', 'visite',
    'sans indice, « visite » par défaut — et c’est dit, pas déduit'],
];
for (const [legende, attendu, quoi] of categories) {
  const r = M.lireLegende(legende);
  const ok = r?.category === attendu;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} catégorie ${attendu.padEnd(8)} ${quoi}`);
  if (!ok) console.log(`   rendu : ${r?.category}`);
}

// ── 4 · Le lieu à géocoder ──────────────────────────────────────────────────
{
  const r = M.lireLegende('📍 Bouillon Chartier, 7 rue du Faubourg Montmartre, Paris');
  const ok = (r?.location || '').includes('Faubourg Montmartre');
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} l'adresse écrite par l'auteur sert à situer le lieu`);
  if (!ok) console.log(`   rendu : ${r?.location}`);
}

const total = titres.length + 2 + categories.length + 1;
console.log(casses ? `\n${casses} cas cassé(s) sur ${total}\n` : `\nles ${total} cas passent\n`);
process.exit(casses ? 1 : 0);
