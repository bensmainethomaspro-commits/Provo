/**
 * Un nom sans point sur la carte : lequel des lieux trouvés est-ce ?
 * (`src/utils/situer.js`)
 *
 * Le 11 novembre 2026, un lien de partage Google vers un restaurant de Rome,
 * collé dans un voyage à Biarritz, est ressorti en fiche nue, et l'app a dit
 * le lieu « pas répertorié dans la carte ouverte ». Elle ne l'avait cherché
 * qu'autour de Biarritz. Chaque cas ci-dessous est une liste de résultats telle
 * que `searchPlaces` la rend : aucun réseau.
 *
 * Usage :  node scripts/verif-situer.mjs
 */
import {
  aProposer, fortAilleurs, fortPresDuVoyage, loinDuVoyage, villeEtPays, LOIN_KM,
} from '../src/utils/situer.js';

let ok = 0, ko = 0;
const verifier = (nom, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nom}`); }
  else { ko++; console.log(`  ✗ ${nom}${detail ? ` — ${detail}` : ''}`); }
};
const J = JSON.stringify;

const BIARRITZ = { lat: 43.4832, lon: -1.5586 };
const VIENNE = { lat: 48.2082, lon: 16.3738 };
const lieu = (title, lat, lon, plus = {}) => ({ id: `${title}${lat}`, title, lat, lon, address: '', _score: 12, ...plus });

const adeva = lieu('ADEVA Cucina Moderna', 41.9021, 12.4847, { address: '29 Via dei Maroniti, Rome, Italie' });
const cucina = lieu('La Cucina', 43.4830, -1.5590, { address: '4 Rue du Helder, Biarritz, France' });

console.log('\n1 · Près du voyage, le nom entier');
{
  const r = fortPresDuVoyage('Rocher de la Vierge', [lieu('Rocher de la Vierge', 43.4846, -1.5700)], BIARRITZ);
  verifier('un lieu qui porte le nom, près du voyage : c’est lui', r.lieu?.title === 'Rocher de la Vierge');
  // Ce que rendait la recherche « ADEVA Cucina Moderna, Biarritz » : un voisin
  // qui partage un mot. Il était écrit d'office dans la fiche.
  const v = fortPresDuVoyage('ADEVA Cucina Moderna', [cucina], BIARRITZ);
  verifier('un voisin qui ne partage qu’un mot n’est PAS retenu', v.lieu === null && !v.candidats.length, J(v));
  // Un lieu qui porte le nom mais à 1 100 km n'est pas « près du voyage ».
  const l = fortPresDuVoyage('ADEVA Cucina Moderna', [adeva], BIARRITZ);
  verifier('le bon lieu, loin du voyage, n’est pas pris pour un voisin', l.lieu === null && !l.candidats.length);
  // Le même commerce en point et en bâtiment : un seul lieu.
  const d = fortPresDuVoyage('Figlmüller', [lieu('Figlmüller', 48.2090, 16.3745), lieu('Figlmüller', 48.2091, 16.3746)], VIENNE);
  verifier('le même lieu rendu deux fois n’est pas un choix à faire', d.lieu?.title === 'Figlmüller' && !d.candidats.length);
  // Deux adresses d'une même enseigne : à la personne de dire.
  const deux = fortPresDuVoyage('Figlmüller', [
    lieu('Figlmüller Wollzeile', 48.2090, 16.3745), lieu('Figlmüller Bäckerstraße', 48.2086, 16.3770)], VIENNE);
  verifier('deux adresses de la même enseigne : on fait choisir', deux.lieu === null && deux.candidats.length === 2);
  // … sauf si le classement les départage nettement.
  const net = fortPresDuVoyage('Figlmüller', [
    lieu('Figlmüller', 48.2090, 16.3745, { _score: 17 }), lieu('Figlmüller Bäckerstraße', 48.2086, 16.3770, { _score: 9 })], VIENNE);
  verifier('le premier détache nettement : pas de question', net.lieu?.title === 'Figlmüller');
  // Le nom d'usage dans une autre langue, porté par une variante.
  const opera = lieu('Wiener Staatsoper', 48.2029, 16.3689, { noms: ['Wiener Staatsoper', 'Vienna State Opera', 'Opéra d’État de Vienne'] });
  verifier('le nom anglais d’un lieu au nom allemand', fortPresDuVoyage('Vienna state opera', [opera], VIENNE).lieu === opera);
  verifier('sans ancre connue, la distance ne filtre rien',
    fortPresDuVoyage('ADEVA Cucina Moderna', [adeva], null).lieu === adeva);
  verifier('un résultat sans coordonnées est ignoré',
    fortPresDuVoyage('X Y Z W', [{ title: 'X Y Z W' }], null).lieu === null);
}

console.log('\n2 · Ailleurs : seul au monde à porter ce nom');
{
  const r = fortAilleurs('ADEVA Cucina Moderna', [adeva]);
  verifier('le restaurant de Rome, cherché depuis un voyage à Biarritz', r.lieu === adeva && !r.candidats.length);
  const porto = lieu('Café Central', 41.1496, -8.6109, { address: 'Porto, Portugal' });
  const wien = lieu('Café Central', 48.2104, 16.3654, { address: 'Vienne, Autriche' });
  const h = fortAilleurs('Café Central', [wien, porto]);
  verifier('deux homonymes : aucun n’est écrit, les deux sont proposés', h.lieu === null && h.candidats.length === 2);
  verifier('un mot en commun ne suffit pas, loin du voyage', fortAilleurs('ADEVA Cucina Moderna', [cucina]).lieu === null
    && fortAilleurs('ADEVA Cucina Moderna', [cucina]).candidats.length === 0);
  verifier('une adresse nue n’est pas un établissement',
    fortAilleurs('Via Roma Trattoria', [lieu('Via Roma Trattoria', 38.1, 13.3, { isAddress: true })]).lieu === null);
  verifier('rien trouvé : rien', fortAilleurs('ADEVA Cucina Moderna', []).lieu === null);
}

console.log('\n3 · Ce qui se propose, sans jamais s’écrire tout seul');
{
  const autre = lieu('Bar Jean', 43.4840, -1.5600);
  const p = aProposer('ADEVA Cucina Moderna', [autre, cucina, adeva], BIARRITZ);
  verifier('ce qui partage un mot passe devant', p[0] === cucina && p[1] === autre, J(p.map(x => x.title)));
  verifier('ce qui est loin du voyage n’est pas un voisin à proposer', !p.includes(adeva));
  verifier('plafonné : une liste, pas un annuaire',
    aProposer('x', Array.from({ length: 9 }, (_, i) => lieu(`L${i}`, 43.48, -1.55)), BIARRITZ).length === 4);
}

console.log('\n4 · Dire que c’est loin, et où');
{
  const km = loinDuVoyage(adeva, BIARRITZ);
  verifier('Rome depuis Biarritz : loin, et la distance est juste', km > 1050 && km < 1200, String(km));
  verifier('un lieu du voyage ne déclenche rien', loinDuVoyage(cucina, BIARRITZ) === null);
  verifier('sans ancre, on ne dit rien', loinDuVoyage(adeva, null) === null);
  verifier('sans coordonnées, on ne dit rien', loinDuVoyage({ title: 'x' }, BIARRITZ) === null);
  verifier(`le seuil est celui du contrôle des lieux (${LOIN_KM} km)`, LOIN_KM === 150);
  verifier('« Rome, Italie » : la ville et le pays, pas la rue',
    villeEtPays('29 Via dei Maroniti, Rome, Italie') === 'Rome, Italie');
  verifier('une adresse courte reste entière', villeEtPays('Vienne, Autriche') === 'Vienne, Autriche');
  verifier('pas d’adresse : chaîne vide', villeEtPays('') === '' && villeEtPays(undefined) === '');
}

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
