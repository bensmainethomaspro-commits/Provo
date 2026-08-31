/**
 * Vérifie la lecture d'un ticket de caisse, sur le texte qu'en tire l'OCR.
 *
 * L'OCR lui-même n'est pas rejoué ici : ce qui décide, c'est l'interprétation,
 * et elle se vérifie sans navigateur et sans image. Les entrées ci-dessous sont
 * écrites comme un OCR les rend vraiment — colonnes écrasées, lignes de
 * séparation, et les confusions O/0 qui vont avec.
 *
 * LE MONTANT EST LA SEULE CHOSE QUI COMPTE VRAIMENT. Le commerce et la date se
 * corrigent d'un regard ; un montant faux se découvre à la fin du voyage, quand
 * plus personne ne se souvient de ce qu'on a payé. D'où les trois règles que
 * ces cas figent :
 *
 *   1. Le total ANNONCÉ par le ticket l'emporte sur tout le reste.
 *   2. « Sous-total », « TVA », « Rendu monnaie » ne sont JAMAIS le total.
 *   3. Rien de lisible → rien du tout, jamais un chiffre pris au hasard.
 *
 * Usage :  node scripts/verif-ticket.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/utils/ticket.js', import.meta.url), 'utf8');
const M = await import('data:text/javascript;base64,' +
  Buffer.from(src).toString('base64'));

const T = M.lireTicketTexte;

// ── 1 · Le montant, sur des tickets entiers ─────────────────────────────────
const tickets = [
  {
    nom: 'un ticket de restaurant ordinaire',
    texte: `FIGLMULLER
Wollzeile 5, 1010 Wien
--------------------------
2 Schnitzel        39,00
1 Bier              5,40
--------------------------
Sous-total         44,40
TVA 10%             4,44
TOTAL TTC          48,84
Carte bancaire     48,84
31/08/2026 20:14`,
    // La catégorie reste « autre » : ce ticket autrichien ne porte aucun mot
    // que les règles connaissent. Deviner « repas » depuis « Schnitzel »
    // demanderait un dictionnaire par pays — le champ se corrige d'un tap, et
    // une catégorie fausse coûte plus qu'une catégorie vide.
    attendu: (r) => r.montant === 48.84 && r.confiance === 'haute'
      && r.commerce === 'FIGLMULLER' && r.date === '2026-08-31'
      && r.categorie === 'autre',
  },
  {
    nom: '« Net à payer » l’emporte sur « Total »',
    texte: `SUPERMARCHE
Total          52,10
Remise          5,00
Net à payer    47,10`,
    attendu: (r) => r.montant === 47.10 && r.confiance === 'haute',
  },
  {
    nom: 'le rendu de monnaie n’est pas le total',
    texte: `CAFE CENTRAL
TOTAL           12,50
Espèces         20,00
Rendu monnaie    7,50`,
    attendu: (r) => r.montant === 12.50 && r.confiance === 'haute',
  },
  {
    nom: 'sans mot « total », le plus grand montant — et on le dit',
    texte: `BOULANGERIE
Pain              1,20
Croissant         1,30
                  2,50`,
    attendu: (r) => r.montant === 2.50 && r.confiance === 'basse',
  },
  {
    nom: 'un montant à quatre chiffres avec séparateur de milliers',
    texte: `HOTEL SACHER
TOTAL TTC     1 240,00 EUR`,
    attendu: (r) => r.montant === 1240 && r.devise === 'EUR'
      && r.categorie === 'hebergement',
  },
  {
    nom: 'le total ferme la ligne, même précédé d’une quantité',
    texte: `TABAC
TOTAL 3 articles      17,60`,
    attendu: (r) => r.montant === 17.60,
  },
  {
    nom: 'un mot connu donne la catégorie',
    texte: `LE PETIT RESTAURANT
Menu du jour
TOTAL TTC       24,00`,
    attendu: (r) => r.categorie === 'repas' && r.montant === 24,
  },
  {
    nom: 'un ticket en dollars',
    texte: `DINER
TOTAL          $ 23,40`,
    attendu: (r) => r.montant === 23.40 && r.devise === 'USD',
  },
  {
    nom: 'rien de lisible : on ne rend rien',
    texte: `~~~~~~~~
||||  ||
~~~~~~~~`,
    attendu: (r) => r.error === 'illisible',
  },
  {
    nom: 'une image vide',
    texte: '',
    attendu: (r) => r.error === 'illisible',
  },
  {
    nom: 'des nombres sans décimales ne sont pas des prix',
    texte: `PARKING
Place 42
Niveau 3
Ticket 100234`,
    attendu: (r) => r.error === 'illisible',
  },
];

let casses = 0;
for (const t of tickets) {
  let r, jete = '';
  try { r = T(t.texte); } catch (e) { jete = String(e.message || e); }
  const ok = !jete && t.attendu(r);
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${t.nom}`);
  if (jete) console.log(`   a jeté : ${jete}`);
  else if (!ok) console.log(`   rendu : ${JSON.stringify(r)}`);
}

// ── 2 · Le nom du commerce ──────────────────────────────────────────────────
const commerces = [
  [['CAFE CENTRAL', 'Herrengasse 14', 'TOTAL 12,50'], 'CAFE CENTRAL',
    "l'enseigne est en tête, avant l'adresse"],
  [['*** TICKET ***', 'LE PETIT ZINC', 'TOTAL 30,00'], 'LE PETIT ZINC',
    'une ligne de décoration ne fait pas un nom'],
  [['12 rue de la Paix', 'TOTAL 30,00'], '',
    'une adresse seule ne fait pas un nom : on ne rend rien'],
  [['SIRET 12345678900011', 'TOTAL 30,00'], '',
    'un numéro non plus'],
];
for (const [lignes, attendu, quoi] of commerces) {
  const rendu = M.lireCommerce(lignes);
  const ok = rendu === attendu;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} commerce → ${attendu || '(rien)'}   ${quoi}`);
  if (!ok) console.log(`   rendu : ${rendu || '(rien)'}`);
}

// ── 3 · La date ─────────────────────────────────────────────────────────────
const dates = [
  [['31/08/2026 20:14'], '2026-08-31', 'le format d’une caisse française'],
  [['2026-08-31'], '2026-08-31', 'ISO'],
  [['31.08.26'], '2026-08-31', 'abrégé, séparé par des points'],
  [['Merci de votre visite'], '', 'aucune date'],
];
for (const [lignes, attendu, quoi] of dates) {
  const rendu = M.lireDateTicket(lignes);
  const ok = rendu === attendu;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} date → ${attendu || '(vide)'}   ${quoi}`);
  if (!ok) console.log(`   rendu : ${rendu || '(vide)'}`);
}

const total = tickets.length + commerces.length + dates.length;
console.log(casses ? `\n${casses} cas cassé(s) sur ${total}\n` : `\nles ${total} cas passent\n`);
process.exit(casses ? 1 : 0);
