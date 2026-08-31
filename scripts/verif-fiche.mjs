/**
 * Vérifie la lecture d'une fiche de lieu SANS modèle payant.
 *
 * `enrich-place` appelait un modèle pour lire, en langue naturelle, ce que les
 * sites publient déjà en JSON-LD pour Google. Sur les quatre champs qui nous
 * intéressent — horaires, fourchette de prix, téléphone, description — les
 * données structurées sont plus sûres : on recopie ce que le lieu affirme de
 * lui-même au lieu de le déduire. Et elles ne coûtent rien.
 *
 * Ce qui se vérifie ici, dans l'ordre d'importance :
 *
 *   1. UNE FOURCHETTE DE PRIX N'EST JAMAIS INVENTÉE. `priceRange: "€€"` est une
 *      catégorie, pas un prix — le convertir en euros mettrait un chiffre faux
 *      dans le budget de quelqu'un.
 *   2. Les horaires ressortent au format d'OpenStreetMap, le seul que l'app
 *      sache lire (`ouvertMaintenant`).
 *   3. Une page qui ne déclare rien rend des champs vides, pas des déductions.
 *
 * Les fonctions sont découpées dans la fonction Edge, jamais recopiées.
 *
 * Usage :  node scripts/verif-fiche.mjs
 */
import { readFileSync } from 'node:fs';
import { decouper } from './ts-sans-types.mjs';

const src = readFileSync(
  new URL('../supabase/functions/enrich-place/index.ts', import.meta.url), 'utf8');
const bloc = decouper(src, 'const JOURS', "// ── Point d'entrée");
// `texteLisible` vit plus haut dans le fichier : la lecture des `meta` s'en sert.
const util = decouper(src, 'function texteLisible', 'function imageDeLaPage');

const { lireLesDonnees, horairesDepuisSpec, fourchette } = new Function(
  `${util}
   ${bloc}
   return { lireLesDonnees, horairesDepuisSpec, fourchette };`)();

const ld = (o) => `<html><head><script type="application/ld+json">${JSON.stringify(o)}</script></head><body>x</body></html>`;

// ── 1 · Le prix ne s'invente pas ────────────────────────────────────────────
const prix = [
  ['€€', null, null, 'une catégorie de prix n’est pas un prix'],
  ['$$$', null, null, 'idem en dollars'],
  ['', null, null, 'rien'],
  ['15-30 €', 15, 30, 'une vraie fourchette chiffrée'],
  ['€15–€30', 15, 30, 'avec le symbole collé et un tiret long'],
  ['À partir de 12,50 €', 12.5, null, 'un seul chiffre : pas de maximum inventé'],
  ['Menu 24 EUR', 24, null, 'le code ISO écrit en toutes lettres'],
];
let casses = 0;
for (const [entree, min, max, quoi] of prix) {
  const r = fourchette(entree);
  const ok = r.prixMin === min && r.prixMax === max;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} priceRange ${JSON.stringify(entree).padEnd(22)} → ${min} / ${max}   ${quoi}`);
  if (!ok) console.log(`   rendu : ${r.prixMin} / ${r.prixMax}`);
}

// ── 2 · Les horaires, au format d'OpenStreetMap ─────────────────────────────
const horaires = [
  [[{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['https://schema.org/Monday', 'https://schema.org/Tuesday'], opens: '09:00', closes: '18:00' }],
    'Mo,Tu 09:00-18:00', 'le format schema.org complet'],
  [[{ dayOfWeek: 'Saturday', opens: '10:00', closes: '16:00' },
    { dayOfWeek: 'Sunday', opens: '11:00', closes: '15:00' }],
    'Sa 10:00-16:00; Su 11:00-15:00', 'deux plages, séparées par un point-virgule'],
  [[{ dayOfWeek: 'Lundi', opens: '9:00', closes: '18:30' }],
    'Mo 09:00-18:30', 'un site français, et une heure sans zéro devant'],
  [[{ dayOfWeek: 'Monday' }], '', 'une spécification sans heures ne rend rien'],
  [[], '', 'rien du tout'],
];
for (const [spec, attendu, quoi] of horaires) {
  const rendu = horairesDepuisSpec(spec);
  const ok = rendu === attendu;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} horaires → ${JSON.stringify(attendu).padEnd(34)} ${quoi}`);
  if (!ok) console.log(`   rendu : ${JSON.stringify(rendu)}`);
}

// ── 3 · Des pages entières, comme elles arrivent ────────────────────────────
const pages = [
  {
    nom: 'un restaurant qui publie tout',
    html: ld({
      '@context': 'https://schema.org', '@type': 'Restaurant', name: 'Figlmüller',
      telephone: '+43 1 5126177', priceRange: '18-35 €',
      description: 'Maison viennoise fondée en 1905, connue pour son escalope panée servie plus large que l’assiette.',
      openingHoursSpecification: [
        { dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '11:30', closes: '22:30' },
      ],
    }),
    attendu: (r) => r.horaires === 'Mo,Tu,We,Th,Fr 11:30-22:30' && r.prixMin === 18
      && r.prixMax === 35 && r.devise === 'EUR' && r.telephone === '+43 1 5126177'
      && r.description.startsWith('Maison viennoise') && r.confiance === 'haute',
  },
  {
    nom: 'un @graph, comme le pose WordPress',
    html: ld({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebSite', name: 'Café bel étage' },
      { '@type': 'CafeOrCoffeeShop', openingHours: ['Mo-Su 09:00-23:00'], priceRange: '€€' },
    ] }),
    attendu: (r) => r.horaires === 'Mo-Su 09:00-23:00' && r.prixMin === null
      && r.confiance === 'haute',
  },
  {
    nom: 'aucune donnée structurée : la description du site suffit, sans plus',
    html: '<html><head><meta property="og:description" content="Le plus ancien café de la ville, ouvert depuis 1876."></head><body>x</body></html>',
    attendu: (r) => r.trouve === true && r.horaires === '' && r.prixMin === null
      && r.confiance === 'basse' && r.description.includes('ancien'),
  },
  {
    nom: 'une page muette ne rend rien',
    html: '<html><body><p>Bienvenue</p></body></html>',
    attendu: (r) => r.trouve === false && r.horaires === '' && r.description === ''
      && r.prixMin === null,
  },
  {
    nom: 'du JSON-LD cassé ne fait pas tomber la lecture',
    html: '<script type="application/ld+json">{ ceci n’est pas du json </script>'
      + ld({ '@type': 'Museum', openingHours: 'Tu-Su 10:00-18:00' }),
    attendu: (r) => r.horaires === 'Tu-Su 10:00-18:00',
  },
];
for (const p of pages) {
  let r, jete = '';
  try { r = lireLesDonnees(p.html); } catch (e) { jete = String(e.message || e); }
  const ok = !jete && p.attendu(r);
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${p.nom}`);
  if (jete) console.log(`   a jeté : ${jete}`);
  else if (!ok) console.log(`   rendu : ${JSON.stringify(r)}`);
}

const total = prix.length + horaires.length + pages.length;
console.log(casses ? `\n${casses} cas cassé(s) sur ${total}\n` : `\nles ${total} cas passent\n`);
process.exit(casses ? 1 : 0);
