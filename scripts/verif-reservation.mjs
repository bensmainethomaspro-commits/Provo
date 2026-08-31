/**
 * Vérifie la lecture d'une confirmation de réservation SANS modèle payant.
 *
 * Une confirmation n'est pas de la prose : c'est un formulaire déguisé, écrit
 * pour être lu vite par un humain pressé. Des règles le lisent aussi bien, et
 * gratuitement — à condition de ne JAMAIS deviner en silence.
 *
 * Ce qui se vérifie ici, dans l'ordre d'importance :
 *
 *   1. UNE DATE FAUSSE SE DÉCOUVRE LE JOUR DU DÉPART. « 09/12 » se lit dans les
 *      deux sens ; quand rien ne tranche, on prend l'ordre français ET on
 *      abaisse la confiance. Quand un des deux nombres dépasse 12, plus
 *      d'ambiguïté et la confiance remonte.
 *   2. Ce qui n'est pas lu reste vide. Pas de référence inventée, pas d'adresse
 *      déduite, pas de catégorie par défaut déguisée en certitude.
 *   3. Les formats qu'on rencontre vraiment : ISO, français, anglais, avec ou
 *      sans année, « 20h », « 8:00 PM ».
 *
 * Les fonctions sont découpées dans la fonction Edge, jamais recopiées.
 *
 * Usage :  node scripts/verif-reservation.mjs
 */
import { readFileSync } from 'node:fs';
import { decouper } from './ts-sans-types.mjs';

const src = readFileSync(
  new URL('../supabase/functions/read-booking/index.ts', import.meta.url), 'utf8');
const bloc = decouper(src, '// ── Les mois', 'Deno.serve');

const M = new Function(`${bloc}
  return { lireDate, lireHeures, lireReference, lireAdresse, lireCategorie,
           lireLieuEtTitre, lireReservation };`)();

// Un « aujourd'hui » fixe : sans lui, les cas sans année changeraient de
// résultat au fil des mois et le test deviendrait un piège.
const LE_JOUR = new Date(2026, 7, 31); // 31 août 2026

// ── 1 · Les dates ───────────────────────────────────────────────────────────
const dates = [
  ['Arrivée le 2026-09-12', '2026-09-12', true, 'ISO : aucune ambiguïté'],
  ['Check-in : 12/09/2026', '2026-09-12', false,
    'jour/mois indistinct de mois/jour : ordre français, confiance abaissée'],
  ['Départ le 25/12/2026', '2026-12-25', true,
    '25 ne peut être qu\'un jour : plus d\'ambiguïté'],
  ['Reservation for 09/25/2026', '2026-09-25', true,
    'le format américain se lève tout seul quand le second nombre dépasse 12'],
  ['Le 12 septembre 2026 à 15h', '2026-09-12', true, 'français, en toutes lettres'],
  ['ven. 12 sept. 2026', '2026-09-12', true, 'abrégé, avec le jour de la semaine'],
  ['September 12, 2026', '2026-09-12', true, 'anglais'],
  ['12 September 2026', '2026-09-12', true, 'anglais, jour en tête'],
  ['Votre table le 3 octobre', '2026-10-03', false,
    'sans année : on prend celle qui vient, et on le signale'],
  ['Le 15 mars', '2027-03-15', false,
    'sans année, et bien passée cette année-ci : ce sera l\'an prochain'],
  ['12.09.2026', '2026-09-12', false, 'séparé par des points'],
  ['aucune date ici', '', false, 'rien à lire, rien à inventer'],
];

let casses = 0;
for (const [entree, attendu, sur, quoi] of dates) {
  const r = M.lireDate(entree, LE_JOUR);
  const ok = r.date === attendu && r.sur === sur;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${JSON.stringify(entree).padEnd(34)} → ${attendu || '(vide)'}`
    + `${sur ? '' : ' · à relire'}   ${quoi}`);
  if (!ok) console.log(`   rendu : ${r.date || '(vide)'} · sur=${r.sur}`);
}

// ── 2 · Les heures ──────────────────────────────────────────────────────────
const heures = [
  ['Départ 14:30 – arrivée 16:05', '14:30', '16:05', 'deux heures sur la même ligne'],
  ['Table à 20h00', '20:00', '', 'le format français'],
  ['à 20h', '20:00', '', 'sans les minutes'],
  ['Boarding at 8:00 PM', '20:00', '', "l'après-midi anglo-saxon"],
  ['at 12:30 AM', '00:30', '', 'minuit et demi'],
  ['Prix 2026 euros', '', '', "une année n'est pas une heure"],
];
for (const [entree, h, f, quoi] of heures) {
  const r = M.lireHeures(entree);
  const ok = r.heure === h && r.fin === f;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${JSON.stringify(entree).padEnd(34)} → ${h || '—'} / ${f || '—'}   ${quoi}`);
  if (!ok) console.log(`   rendu : ${r.heure || '—'} / ${r.fin || '—'}`);
}

// ── 3 · La référence ────────────────────────────────────────────────────────
const refs = [
  ['Référence : XK7P2Q', 'XK7P2Q', 'la forme la plus courante'],
  ['Confirmation #A1B2C3D4', 'A1B2C3D4', 'avec un dièse'],
  ['Numéro de dossier : 8842013', '8842013', 'tout en chiffres'],
  ['Réservation : CONFIRMÉE', '', "un mot sans chiffre n'est pas une référence"],
  ['Merci de votre visite', '', 'rien à lire'],
];
for (const [entree, attendu, quoi] of refs) {
  const r = M.lireReference(entree);
  const ok = r === attendu;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} référence ${JSON.stringify(entree).padEnd(32)} → ${attendu || '(vide)'}   ${quoi}`);
  if (!ok) console.log(`   rendu : ${r || '(vide)'}`);
}

// ── 4 · Des confirmations entières, comme on les colle ──────────────────────
const collages = [
  {
    nom: 'un courriel d’hôtel',
    texte: `Hôtel Sacher Wien
Votre réservation est confirmée.

Référence : XK7P2Q
Check-in : 12/09/2026 à 15:00
Check-out : 15/09/2026 à 11:00
Adresse : Philharmoniker Str. 4, 1010 Wien
Chambre Deluxe, 2 personnes`,
    attendu: (r) => r.categorie === 'repos' && r.lieu.startsWith('Hôtel Sacher')
      && r.date === '2026-09-12' && r.heure === '15:00'
      && r.reference === 'XK7P2Q' && r.adresse.startsWith('Philharmoniker')
      && r.confiance === 'basse', // 12/09 reste ambigu : ça se relit
  },
  {
    nom: 'un billet de train',
    texte: `Votre billet de train
Paris Gare de Lyon → Vienne Hbf
Départ le 25/12/2026 à 14:30 — arrivée 16:05
Voiture 12, place 44
Dossier : TR88201`,
    attendu: (r) => r.categorie === 'trajet' && r.date === '2026-12-25'
      && r.heure === '14:30' && r.fin === '16:05' && r.reference === 'TR88201'
      && r.titre.includes('→'),
  },
  {
    nom: 'une table au restaurant, sans année',
    texte: `Restaurant Figlmüller vous confirme votre table.
Le 3 octobre à 20h00 pour 2 personnes.
Wollzeile 5, 1010 Wien`,
    attendu: (r) => r.categorie === 'resto' && r.lieu === 'Restaurant Figlmüller'
      && r.date === '2026-10-03' && r.heure === '20:00'
      && r.confiance === 'basse' && r.reference === '',
  },
  {
    nom: 'un texte qui n’est pas une réservation',
    texte: '   ',
    attendu: (r) => r.erreur === 'pas_une_reservation',
  },
];
for (const c of collages) {
  let r, jete = '';
  try { r = M.lireReservation(c.texte, LE_JOUR); } catch (e) { jete = String(e.message || e); }
  const ok = !jete && c.attendu(r);
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${c.nom}`);
  if (jete) console.log(`   a jeté : ${jete}`);
  else if (!ok) console.log(`   rendu : ${JSON.stringify(r)}`);
}

const total = dates.length + heures.length + refs.length + collages.length;
console.log(casses ? `\n${casses} cas cassé(s) sur ${total}\n` : `\nles ${total} cas passent\n`);
process.exit(casses ? 1 : 0);
