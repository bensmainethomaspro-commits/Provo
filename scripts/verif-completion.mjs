/**
 * La complétion automatique d'une fiche (`lookupPlace`, src/utils/enrich.js)
 * ne doit écrire QUE le bon lieu.
 *
 * Elle écrivait le résultat le mieux « renseigné » sans vérifier son nom, et
 * jusqu'à 500 km du voyage : la fiche « Wiener Staatsoper » pouvait recevoir
 * l'adresse d'un lieu d'Italie. Chaque cas simule les réponses des services
 * (Nominatim, Photon, Overpass) : aucun réseau.
 *
 * Usage :  node scripts/verif-completion.mjs
 */
let reponses = {};
const appels = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  appels.push(u);
  const service = u.includes('nominatim') ? 'nominatim' : u.includes('photon') ? 'photon' : 'overpass';
  const r = reponses[service];
  const corps = typeof r === 'function' ? r(u) : r;
  if (corps === 429) return { ok: false, status: 429, json: async () => { throw new Error('pas du JSON'); } };
  return { ok: true, status: 200, json: async () => corps ?? (service === 'nominatim' ? [] : service === 'photon' ? { features: [] } : { elements: [] }) };
};

const { lookupPlace, nomSansPrecision } = await import('../src/utils/enrich.js');

let ok = 0, ko = 0;
const v = (nom, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nom}`); } else { ko++; console.log(`  ✗ ${nom} — ${detail}`); }
};
const VIENNE = { lat: 48.2082, lon: 16.3738 };
const ATHENES = { lat: 37.9838, lon: 23.7275 };
const nomi = (name, lat, lon, extra = {}) => ({
  name, lat: String(lat), lon: String(lon), class: 'amenity', type: 'theatre',
  address: { road: 'Rue', city: 'Ville', country: 'Pays' }, extratags: {}, namedetails: { name }, ...extra,
});
const J = JSON.stringify;

console.log('\n1 · Un homonyme lointain n’est jamais écrit');
reponses = { nominatim: [nomi('Opera', 45.38, 9.27, { address: { city: 'Opera', country: 'Italia' } })] };
let r = await lookupPlace('Wiener Staatsoper', 'Vienne', VIENNE);
v('Opera (Italie, 600 km) refusé', r === null, J(r));

console.log('\n2 · Un voisin qui porte un autre nom n’est pas le lieu');
reponses = {
  nominatim: [nomi('Hotel Sacher', 48.2039, 16.3694, { extratags: { opening_hours: '24/7' } })],
};
r = await lookupPlace('Café Central', 'Vienne', VIENNE);
v('Hotel Sacher (200 m, avec horaires) refusé', r === null, J(r));

console.log('\n3 · Le nom latin retrouvé dans les variantes d’un nom grec');
reponses = {
  nominatim: [nomi('Μουσείο Ακρόπολης', 37.9685, 23.7285, {
    class: 'tourism', type: 'museum',
    address: { house_number: '15', road: 'Dionysiou Areopagitou', city: 'Athènes', country: 'Grèce' },
    extratags: { opening_hours: 'Mo-Su 09:00-17:00' },
    namedetails: { name: 'Μουσείο Ακρόπολης', 'name:en': 'Acropolis Museum' },
  })],
};
r = await lookupPlace('Acropolis Museum', 'Athènes', ATHENES);
v('adresse et horaires retrouvés', r?.address === '15 Dionysiou Areopagitou, Athènes, Grèce'
  && r.openingHours === 'Mo-Su 09:00-17:00', J(r));

console.log('\n4 · Nominatim refuse (429) : Photon prend le relais, nom vérifié');
reponses = {
  nominatim: 429,
  photon: { features: [
    { geometry: { coordinates: [23.7240, 37.9760] }, properties: { name: 'Autre Taverne', osm_key: 'amenity', street: 'X', city: 'Athènes', country: 'Grèce' } },
    { geometry: { coordinates: [23.7241, 37.9747] }, properties: { name: 'Taverna Platanos', osm_key: 'amenity', housenumber: '4', street: 'Diogenous', city: 'Athènes', country: 'Grèce' } },
  ] },
};
r = await lookupPlace('Taverna Platanos', 'Athènes', ATHENES);
v('le bon nom parmi deux, adresse remplie', r?.address === '4 Diogenous, Athènes, Grèce', J(r));

console.log('\n5 · La précision ajoutée au titre ne bloque plus la recherche');
v('parenthèses retirées', nomSansPrecision('Acropole (billets coupe-file)') === 'Acropole');
v('« - visite guidée » retiré', nomSansPrecision('Sagrada Família - visite guidée') === 'Sagrada Família');
v('un nom trop court reste entier', nomSansPrecision('Bo (resto)') === 'Bo (resto)');
reponses = {
  nominatim: (u) => (decodeURIComponent(u).includes('Colisée,') && !decodeURIComponent(u).includes('(')
    ? [nomi('Colisée', 41.8902, 12.4922, { class: 'tourism', address: { road: 'Piazza del Colosseo', city: 'Rome', country: 'Italie' } })]
    : []),
};
r = await lookupPlace('Colisée (réservé 10h)', 'Rome', { lat: 41.8933, lon: 12.4829 });
v('trouvé grâce au nom court', r?.address === 'Piazza del Colosseo, Rome, Italie', J(r));

console.log('\n6 · Overpass : le bon nom, pas le premier venu');
reponses = {
  overpass: { elements: [
    { lat: 48.21, lon: 16.36, tags: { name: 'Demel Shop Outlet' } },
    { lat: 48.2087, lon: 16.3671, tags: { name: 'Demel', opening_hours: 'Mo-Su 09:00-19:00', 'addr:street': 'Kohlmarkt', 'addr:housenumber': '14' } },
  ] },
};
r = await lookupPlace('Demel', 'Vienne', VIENNE);
v('Demel avec ses horaires', r?.openingHours === 'Mo-Su 09:00-19:00' && r.address.startsWith('14 Kohlmarkt'), J(r));

console.log('\n7 · Un échec est retenu dix minutes : pas sept appels de plus');
reponses = {};
r = await lookupPlace('Lieu Introuvable Xyz', 'Vienne', VIENNE);
const avant = appels.length;
const r2 = await lookupPlace('Lieu Introuvable Xyz', 'Vienne', VIENNE);
v('rien trouvé la première fois', r === null);
v('la seconde demande ne rappelle aucun service', r2 === null && appels.length === avant, `${appels.length - avant} appel(s)`);

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
