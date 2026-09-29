/**
 * L'avertissement de doublon à l'ajout : `src/utils/doublon.js`.
 *
 * Usage :  node scripts/verif-doublon.mjs
 */
import { trouverDoublon } from '../src/utils/doublon.js';

let ok = 0, ko = 0;
const v = (nom, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nom}`); } else { ko++; console.log(`  ✗ ${nom} — ${detail}`); }
};
const reserve = [
  { id: 'r1', title: 'Da Enzo al 29', lat: 41.88862, lon: 12.47753, link: 'https://maps.app.goo.gl/AbC' },
  { id: 'r2', title: 'Café de l’Opéra' },
];
const days = [
  { activities: [{ id: 'd1', title: 'Déjeuner', isMeal: true }] },
  { activities: [{ id: 'd2', title: 'Colisée', lat: 41.8902, lon: 12.4922 }] },
];
const d = (f) => trouverDoublon(f, days, reserve);

v('même lien (casse, www, / final)', d({ title: 'X', link: 'HTTPS://maps.app.goo.gl/AbC/' })?.activite.id === 'r1');
v('même point, nom apparenté', d({ title: 'Trattoria Da Enzo', lat: 41.8886, lon: 12.4776 })?.activite.id === 'r1');
v('même point, nom sans rapport : pas un doublon (deux restos dans le même immeuble)',
  d({ title: 'Gelateria', lat: 41.88862, lon: 12.47753 }) === null);
v('même nom, accents et apostrophe près', d({ title: "Cafe de l'Opera" })?.activite.id === 'r2');
v('où il se trouve : au Jour 2', d({ title: 'colisée' })?.ou === 'au Jour 2');
v('un repas n’est pas un lieu', d({ title: 'Déjeuner' }) === null);
v('la fiche elle-même, en modification', trouverDoublon({ id: 'r2', title: 'Café de l’Opéra' }, days, reserve) === null);
v('rien de commun', d({ title: 'Panthéon', lat: 41.8986, lon: 12.4769 }) === null);
v('titre vide', d({ title: '' }) === null);

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
