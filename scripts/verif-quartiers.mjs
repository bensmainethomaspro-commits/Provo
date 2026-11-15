/**
 * Le rangement de la Réserve par quartier (`src/utils/quartiers.js`).
 *
 * Les adresses viennent telles quelles du banc du 15 novembre 2026
 * (`scripts/diag-carnet.mjs`) : c'est ce que la carte ouverte rend vraiment.
 * Le piège mesuré : à Venise, `suburb` vaut « Venezia-Murano-Burano » pour
 * TOUS les lieux — le prendre en premier aurait fait un seul groupe.
 *
 * Usage :  node scripts/verif-quartiers.mjs
 */
import {
  choisirNiveau, quartierDe, rangerParQuartier, rangementPossible, secteursDe, secteursDePhoton,
} from '../src/utils/quartiers.js';

let ok = 0, ko = 0;
const v = (nom, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nom}`); } else { ko++; console.log(`  ✗ ${nom} — ${detail}`); }
};
const J = JSON.stringify;
const fiche = (title, adresse, plus = {}) => ({ title, secteurs: secteursDe(adresse), ...plus });
const noms = (groupes) => groupes.map(g => `${g.quartier}:${g.items.length}`).join(' | ');

console.log('\n1 · Venise : le sestiere, pas la commune');
const VENISE = [
  fiche('Palazzo Ducale', { suburb: 'Venezia-Murano-Burano', neighbourhood: 'San Marco' }),
  fiche('Campanile', { suburb: 'Venezia-Murano-Burano', neighbourhood: 'San Marco' }),
  fiche('Bovolo', { suburb: 'Venezia-Murano-Burano', neighbourhood: 'San Marco' }),
  fiche('Ponte di Rialto', { suburb: 'Venezia-Murano-Burano', neighbourhood: 'San Polo' }),
  fiche('San Rocco', { suburb: 'Venezia-Murano-Burano', neighbourhood: 'San Polo' }),
  fiche('San Pantalon', { suburb: 'Venezia-Murano-Burano', neighbourhood: 'Dorsoduro' }),
  fiche('Ai Promessi Sposi', { suburb: 'Venezia-Murano-Burano', neighbourhood: 'Cannaregio' }),
  fiche('Vino Vero', { suburb: 'Venezia-Murano-Burano', neighbourhood: 'Cannaregio' }),
  fiche('Gallonetto', { suburb: 'Venezia-Murano-Burano', neighbourhood: 'Castello' }),
  fiche('Burano', { suburb: 'Venezia-Murano-Burano' }),
  fiche('Murano', {}),
];
{
  const c = choisirNiveau(VENISE);
  v('le niveau retenu est `neighbourhood`', c.niveau === 'neighbourhood', J(c.niveau));
  v('`suburb` est reconnu comme la ville', c.grossiers.has('suburb'), J([...c.grossiers]));
  const g = rangerParQuartier(VENISE, c);
  v('cinq sestieri, puis les lieux sans quartier', noms(g) === 'Cannaregio:2 | Castello:1 | Dorsoduro:1 | San Marco:3 | San Polo:2 | Sans quartier:2', noms(g));
  v('Burano ne prend pas « Venezia-Murano-Burano »', quartierDe(VENISE[9], c) === '', quartierDe(VENISE[9], c));
  v('le rangement est proposé', rangementPossible(VENISE, c));
}

console.log('\n2 · Rome : le rione');
{
  const ROME = [
    fiche('Da Enzo al 29', { quarter: 'Trastevere', suburb: 'Municipio Roma I', neighbourhood: 'Trastevere' }),
    fiche('Fontana di Trevi', { quarter: 'Trevi', suburb: 'Municipio Roma I' }),
    fiche('Pantheon', { quarter: 'Colonna', suburb: 'Municipio Roma I' }),
    fiche('Santa Maria in Trastevere', { quarter: 'Trastevere', suburb: 'Municipio Roma I' }),
  ];
  const c = choisirNiveau(ROME);
  v('le niveau retenu est `quarter`', c.niveau === 'quarter', J(c.niveau));
  v('trois rioni', noms(rangerParQuartier(ROME, c)) === 'Colonna:1 | Trastevere:2 | Trevi:1', noms(rangerParQuartier(ROME, c)));
}

console.log('\n3 · Paris : l’arrondissement, pas un quartier administratif par lieu');
{
  const PARIS = [
    fiche('Louvre', { quarter: "Saint-Germain-l'Auxerrois", suburb: 'Paris 1er Arrondissement', city_district: 'Paris' }),
    fiche('Comptoir du Relais', { quarter: "Quartier de l'Odéon", suburb: 'Paris 6e Arrondissement', city_district: 'Paris' }),
    fiche('Saint-Sulpice', { quarter: "Quartier de l'Odéon", suburb: 'Paris 6e Arrondissement', city_district: 'Paris' }),
    fiche('Tuileries', { quarter: 'Place-Vendôme', suburb: 'Paris 1er Arrondissement', city_district: 'Paris' }),
    fiche('Musée d’Orsay', { quarter: 'Saint-Thomas-d’Aquin', suburb: 'Paris 7e Arrondissement', city_district: 'Paris' }),
  ];
  const c = choisirNiveau(PARIS);
  v('le niveau retenu est `suburb`', c.niveau === 'suburb', J(c.niveau));
  v('trois arrondissements', noms(rangerParQuartier(PARIS, c)) === 'Paris 1er Arrondissement:2 | Paris 6e Arrondissement:2 | Paris 7e Arrondissement:1',
    noms(rangerParQuartier(PARIS, c)));
  v('« Paris » n’est pas un quartier', c.grossiers.has('city_district'), J([...c.grossiers]));
}

console.log('\n4 · Vienne : le Bezirk');
{
  const VIENNE = [
    fiche('Café Central', { suburb: 'Innere Stadt', city_district: 'Innere Stadt' }),
    fiche('Stephansdom', { suburb: 'Innere Stadt', city_district: 'Innere Stadt' }),
    fiche('Naschmarkt', { suburb: 'Mariahilf', city_district: 'Mariahilf', neighbourhood: 'Laimgrube' }),
    fiche('Belvedere', { suburb: 'Landstraße', city_district: 'Landstraße' }),
  ];
  const c = choisirNiveau(VIENNE);
  v('Innere Stadt, Landstraße, Mariahilf', noms(rangerParQuartier(VIENNE, c)) === 'Innere Stadt:2 | Landstraße:1 | Mariahilf:1',
    `${c.niveau} → ${noms(rangerParQuartier(VIENNE, c))}`);
}

console.log('\n5 · Le quartier d’un carnet passe avant la carte');
{
  const mixte = [
    { title: 'Basilique Saint-Marc', quartier: 'San Marco & Rialto', secteurs: { neighbourhood: 'San Marco' } },
    { title: 'Antico Forno', quartier: 'San Polo' },
    ...VENISE.slice(0, 4),
  ];
  const c = choisirNiveau(mixte);
  const g = rangerParQuartier(mixte, c);
  v('la fiche du carnet garde son secteur', quartierDe(mixte[0], c) === 'San Marco & Rialto');
  v('les deux façons de nommer cohabitent, sans doublon de casse',
    noms(g) === 'San Marco:3 | San Marco & Rialto:1 | San Polo:2', noms(g));
  const casse = rangerParQuartier([{ title: 'a', quartier: 'Cannaregio' }, { title: 'b', quartier: 'CANNAREGIO' }]);
  v('« CANNAREGIO » et « Cannaregio » : un seul groupe', casse.length === 1 && casse[0].items.length === 2, noms(casse));
}

console.log('\n6 · Quand ranger n’a pas de sens');
{
  const un = [fiche('A', { neighbourhood: 'San Marco' }), fiche('B', { neighbourhood: 'San Marco' })];
  v('un seul quartier : pas de rangement', !rangementPossible(un));
  v('aucune fiche située : pas de rangement', !rangementPossible([{ title: 'A' }, { title: 'B' }]));
  v('rien du tout : pas de rangement, pas d’erreur', !rangementPossible([]) && rangerParQuartier([]).length === 0);
  v('sans contexte, le niveau le plus local', quartierDe(fiche('X', { neighbourhood: 'Trastevere', suburb: 'Municipio Roma I' })) === 'Trastevere');
  v('une fiche absente : rien', quartierDe(null) === '');
}

console.log('\n7 · Ce que rendent les services');
v('Nominatim : les quatre niveaux, rien d’autre', J(secteursDe({ neighbourhood: 'San Polo', suburb: 'Venezia-Murano-Burano', city: 'Venezia', road: 'Ruga Rialto' }))
  === '{"neighbourhood":"San Polo","suburb":"Venezia-Murano-Burano"}');
v('Nominatim sans quartier : rien', secteursDe({ city: 'Venezia' }) === null && secteursDe() === null);
v('Photon : `locality` est le quartier, `district` l’arrondissement',
  J(secteursDePhoton({ district: 'Municipio Roma I', locality: 'Trastevere' })) === '{"neighbourhood":"Trastevere","suburb":"Municipio Roma I"}');
v('Photon sans quartier : rien', secteursDePhoton({ city: 'Roma' }) === null);

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
