/**
 * Vérifie la calculatrice du champ « Montant ».
 *
 * Ce que ça protège : de l'ARGENT. Le champ accepte désormais une opération
 * (« 12,50+8 », « 36/3 »), et son résultat part directement dans les dépenses,
 * les soldes et les dettes. Une virgule mal lue ou une priorité inversée ne se
 * verrait qu'à la fin du voyage, au moment de se rembourser.
 *
 * Deux familles de cas, également importantes :
 *  · ce qui doit se calculer juste ;
 *  · ce qui doit rendre `null` — au moindre doute, on ne devine pas un montant.
 *
 * La fonction est découpée dans `helpers.js`, jamais recopiée ici : un test qui
 * recopie le code qu'il teste ne teste plus rien.
 *
 * Usage :  node scripts/verif-calcul.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/utils/helpers.js', import.meta.url), 'utf8');
const bloc = src.slice(src.indexOf('export function evaluerMontant')).replace(/export /g, '');
const { evaluerMontant, estUnCalcul } = new Function(
  `${bloc}; return { evaluerMontant, estUnCalcul };`)();

const cas = [
  // ── Ce qu'on tape vraiment ────────────────────────────────────────────────
  ['18', 18, 'un nombre simple reste un nombre'],
  ['18,50', 18.5, 'la virgule française'],
  ['18.50', 18.5, 'le point, pour les claviers qui ne donnent que lui'],
  ['12,50+8', 20.5, "l'addition d'un ticket partagé"],
  ['36/3', 12, 'une note divisée sur place'],
  ['36÷3', 12, 'le signe de la touche, pas celui du clavier'],
  ['4×2,5', 10, 'un prix unitaire'],
  ['4x2,5', 10, 'le x du clavier vaut le × de la touche'],
  ['20−3', 17, 'le vrai signe moins'],
  ['20-3', 17, 'le tiret du clavier aussi'],
  ['12 + 8', 20, 'les espaces ne comptent pas'],
  ['0', 0, 'zéro est un montant, pas une absence'],

  // ── Priorités : la faute qui ne se verrait qu'à la fin du voyage ──────────
  ['2+3*4', 14, '× passe avant + '],
  ['2*3+4', 10, '… dans les deux sens'],
  ['100/4+5', 30, '÷ passe avant +'],
  ['10-2*3', 4, '× passe avant −'],
  ['1+2+3+4', 10, 'une addition à quatre termes'],

  // ── Arrondi au centime ────────────────────────────────────────────────────
  ['100/3', 33.33, 'au centime, pas plus'],
  ['10/4', 2.5, 'pas de décimale inutile'],

  // ── Pendant la frappe : l'aperçu doit rester juste ────────────────────────
  ['12+', 12, "un opérateur en attente s'ignore"],
  ['12,', 12, 'une virgule en attente aussi'],
  ['12,50+', 12.5, '… même après une décimale'],

  // ── Ce qui doit rendre null ───────────────────────────────────────────────
  ['', null, 'un champ vide n’est pas zéro'],
  ['12++8', null, 'deux opérateurs de suite'],
  ['+12', null, 'une opération qui commence par un signe'],
  ['-5', null, 'un montant négatif se choisit par le segment « Revenu »'],
  ['12€', null, 'une unité collée au nombre'],
  ['1o', null, 'un o pris pour un zéro'],
  ['abc', null, 'du texte'],
  ['1,5.2', null, 'deux séparateurs décimaux'],
  ['10/0', null, 'une division par zéro'],
  ['12 8', null, 'deux nombres sans opérateur'],
  ['*3', null, 'une opération sans premier terme'],
  [null, null, 'rien du tout'],
];

let casses = 0;
for (const [entree, attendu, quoi] of cas) {
  let rendu, jete = '';
  try { rendu = evaluerMontant(entree); }
  catch (e) { jete = String(e.message || e); }
  const ok = !jete && rendu === attendu;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${JSON.stringify(entree)} → ${attendu}   ${quoi}`);
  if (jete) console.log(`   a jeté : ${jete}`);
  else if (!ok) console.log(`   rendu : ${rendu}`);
}

// `estUnCalcul` décide si l'aperçu « = 20,50 € » s'affiche. Trop large, il
// s'allumerait sur un nombre simple ; trop étroit, il resterait muet sur une
// opération et on ne saurait pas ce qui va être enregistré.
const drapeaux = [
  ['18', false], ['18,50', false], ['', false],
  ['12+8', true], ['12-8', true], ['12×8', true], ['12÷8', true],
  ['12−8', true], ['12*8', true], ['12/8', true], ['12x8', true],
];
for (const [entree, attendu] of drapeaux) {
  const ok = estUnCalcul(entree) === attendu;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} estUnCalcul(${JSON.stringify(entree)}) → ${attendu}`);
}

const total = cas.length + drapeaux.length;
console.log(casses ? `\n${casses} cas cassé(s) sur ${total}\n` : `\nles ${total} cas passent\n`);
process.exit(casses ? 1 : 0);
