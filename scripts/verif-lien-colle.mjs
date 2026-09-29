/**
 * Un lien partagé arrive avec du texte autour : `src/utils/lienColle.js`.
 *
 * Usage :  node scripts/verif-lien-colle.mjs
 */
import { lienPartage, lireGeo, premierLien } from '../src/utils/lienColle.js';

let ok = 0, ko = 0;
const v = (nom, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nom}`); } else { ko++; console.log(`  ✗ ${nom} — ${detail}`); }
};
const J = JSON.stringify;

const a = lienPartage('Taverna Platanos\nhttps://maps.apple.com/?q=Taverna%20Platanos&ll=37.97,23.72');
v('Plans : nom sur la ligne du dessus', a?.lien.startsWith('https://maps.apple.com/') && a.indice === 'Taverna Platanos', J(a));
const b = lienPartage('Regarde ce lieu : https://maps.app.goo.gl/AbCd123');
v('« Regarde ce lieu : » n’est pas un nom', b?.lien === 'https://maps.app.goo.gl/AbCd123' && b.indice === null, J(b));
const c = lienPartage('Da Enzo al 29 sur Google Maps https://maps.app.goo.gl/xyz.');
v('« sur Google Maps » retiré, point final hors du lien', c?.lien === 'https://maps.app.goo.gl/xyz' && c.indice === 'Da Enzo al 29', J(c));
const d = lienPartage('Bar in Rome https://exemple.com/bar');
v('« in » gardé quand il fait partie du nom', d?.indice === 'Bar in Rome', J(d));
v('lien nu', lienPartage('https://www.tiktok.com/@x/video/1')?.indice === null);
v('pas de lien', lienPartage('Da Enzo al 29') === null);
const long = 'Ligne 1\nLigne 2\nLigne 3\nLigne 4\nhttps://exemple.com';
v('un long texte n’est pas un partage', lienPartage(long) === null);
v('(le lien entre parenthèses)', premierLien('(voir https://exemple.com/a)') === 'https://exemple.com/a');

const g1 = lireGeo('geo:37.9715,23.7257?q=Acropole');
v('geo: avec nom', g1?.lat === 37.9715 && g1.lon === 23.7257 && g1.nom === 'Acropole', J(g1));
const g2 = lireGeo('geo:0,0?q=41.8902,12.4922(Colisée)');
v('geo:0,0 avec le point dans q', g2?.lat === 41.8902 && g2.lon === 12.4922 && g2.nom === 'Colisée', J(g2));
const g3 = lireGeo('geo:0,0?q=Sagrada+Familia');
v('geo:0,0 sans point : le nom seul', g3?.lat === null && g3.nom === 'Sagrada Familia', J(g3));
v('pas geo', lireGeo('https://exemple.com') === null);

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
