/**
 * Ce qu'un lien dit du lieu, sans réseau : `_shared/lecture-lien.ts`.
 *
 * Chaque cas vient d'une forme de lien réelle qu'on colle en préparant un
 * voyage à l'étranger, et que l'extracteur ne savait pas lire : Plans
 * (Apple), OpenStreetMap, Waze, Bing, Yandex ; une page de restaurant avec
 * son bloc JSON-LD ; un titre Tripadvisor ; un site qui bloque les robots.
 *
 * Usage :  node scripts/verif-lecture-lien.mjs
 */
import {
  accordNom, lienCarte, lireJsonLd, metaGeo, nomDepuisAdresse, nomsConnus, normaliser, titreDeSite,
} from '../supabase/functions/_shared/lecture-lien.ts';

let ok = 0, ko = 0;
const verifier = (nom, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nom}`); }
  else { ko++; console.log(`  ✗ ${nom}${detail ? ` — ${detail}` : ''}`); }
};
const pres = (p, lat, lon) => p && Math.abs(p.lat - lat) < 1e-6 && Math.abs(p.lon - lon) < 1e-6;
const L = (u) => lienCarte(new URL(u));

console.log('\n1 · Liens des autres applications de cartes');
{
  const a = L('https://maps.apple.com/?q=Taverna%20Platanos&ll=37.9747,23.7241&address=Diogenous%204,%20Athens');
  verifier('Plans : nom, point et adresse', a?.nom === 'Taverna Platanos' && pres(a.coords, 37.9747, 23.7241)
    && a.adresse === 'Diogenous 4, Athens', JSON.stringify(a));
  const b = L('https://maps.apple.com/place?coordinate=41.8902,12.4922&name=Colosseo');
  verifier('Plans, format récent (coordinate + name)', b?.nom === 'Colosseo' && pres(b.coords, 41.8902, 12.4922));
  verifier('Plans, lien court : rien à lire avant de le déplier', L('https://maps.apple/p/AbCdEf') === null);
  const c = L('https://www.openstreetmap.org/?mlat=38.7139&mlon=-9.1334#map=17/38.7139/-9.1334');
  verifier('OpenStreetMap : marqueur', pres(c?.coords, 38.7139, -9.1334));
  const d = L('https://www.openstreetmap.org/#map=18/35.0394/135.7292');
  verifier('OpenStreetMap : seulement le centre de la carte', pres(d?.coords, 35.0394, 135.7292));
  const e = L('https://waze.com/ul?ll=40.4168,-3.7038&navigate=yes&q=Puerta%20del%20Sol');
  verifier('Waze : ll + q', e?.nom === 'Puerta del Sol' && pres(e.coords, 40.4168, -3.7038));
  const f = L('https://www.waze.com/live-map/directions?to=ll.52.3731,4.8922');
  verifier('Waze : to=ll.', pres(f?.coords, 52.3731, 4.8922));
  const g = L('https://www.bing.com/maps?cp=48.8584~2.2945&lvl=16&where1=Champ%20de%20Mars');
  verifier('Bing : cp avec tilde', pres(g?.coords, 48.8584, 2.2945) && g.adresse === 'Champ de Mars');
  const h = L('https://yandex.com/maps/?ll=30.3141,59.9398&pt=30.3141,59.9398&text=Hermitage&z=16');
  verifier('Yandex : lon,lat inversés', h?.nom === 'Hermitage' && pres(h.coords, 59.9398, 30.3141));
  verifier('Un site ordinaire n’est pas une carte', L('https://www.exemple.com/?q=Rome&ll=1,2') === null);
  verifier('Une paire de coordonnées n’est pas un nom',
    L('https://maps.apple.com/?q=41.89,12.49&ll=41.89,12.49')?.nom === null);
  verifier('(0, 0) n’est pas un lieu', L('https://maps.apple.com/?ll=0,0') === null);
}

console.log('\n2 · Données structurées de la page (JSON-LD, meta)');
{
  const page = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebSite","name":"Guide"},
      {"@type":["Restaurant","LocalBusiness"],"name":"Da Enzo al 29",
       "address":{"@type":"PostalAddress","streetAddress":"Via dei Vascellari 29","postalCode":"00153","addressLocality":"Roma","addressCountry":"IT"},
       "geo":{"@type":"GeoCoordinates","latitude":"41.8886","longitude":12.4775},
       "openingHours":["Mo-Sa 12:30-15:00","Mo-Sa 19:30-23:00"]}
    ]}</script></head></html>`;
  const lu = lireJsonLd(page);
  verifier('nom lu dans le graphe', lu?.nom === 'Da Enzo al 29', JSON.stringify(lu));
  verifier('adresse postale assemblée (sans le code pays à 2 lettres)',
    lu?.adresse === 'Via dei Vascellari 29, 00153 Roma', lu?.adresse);
  verifier('coordonnées, même en chaîne', pres(lu?.coords, 41.8886, 12.4775));
  verifier('horaires au format OSM', lu?.horaires === 'Mo-Sa 12:30-15:00; Mo-Sa 19:30-23:00');
  verifier('catégorie resto', lu?.categorie === 'resto');

  const musee = lireJsonLd(`<script type='application/ld+json'>{"@type":"Museum","name":"Museu Calouste Gulbenkian &amp; Jardim","address":"Av. de Berna 45A, Lisboa"}</script>`);
  verifier('adresse en texte, entités décodées, catégorie visite',
    musee?.nom === 'Museu Calouste Gulbenkian & Jardim' && musee.adresse === 'Av. de Berna 45A, Lisboa'
    && musee.categorie === 'visite', JSON.stringify(musee));
  const evt = lireJsonLd(`<script type="application/ld+json">{"@type":"Event","name":"Concert","location":{"@type":"MusicVenue","name":"Paradiso","address":"Weteringschans 6, Amsterdam"}}</script>`);
  verifier('un événement : c’est la salle qui est le lieu', evt?.nom === 'Paradiso', JSON.stringify(evt));
  verifier('bloc mal formé : aucun plantage', lireJsonLd('<script type="application/ld+json">{oups</script>') === null);
  verifier('page sans JSON-LD', lireJsonLd('<html><title>x</title></html>') === null);

  verifier('meta place:location', pres(metaGeo(
    '<meta property="place:location:latitude" content="45.4642"><meta property="place:location:longitude" content="9.19">'), 45.4642, 9.19));
  verifier('meta ICBM', pres(metaGeo('<meta name="ICBM" content="50.0875, 14.4213">'), 50.0875, 14.4213));
  verifier('meta geo.position', pres(metaGeo('<meta name="geo.position" content="38.7223;-9.1393">'), 38.7223, -9.1393));
}

console.log('\n3 · Titres de page');
{
  const cas = [
    ['Da Enzo al 29, Rome - Trastevere - Restaurant Reviews, Photos & Phone Number - Tripadvisor', 'Da Enzo al 29, Rome'],
    ['Electra Palace Athens | Booking.com', 'Electra Palace Athens'],
    ['Home | Taverna Platanos', 'Taverna Platanos'],
    ['Musée du Prado – Site officiel', 'Musée du Prado'],
    ['Just a moment...', ''],
    ['Access Denied', ''],
    ['Pardon Our Interruption', ''],
    ['Sagrada Família', 'Sagrada Família'],
  ];
  for (const [brut, attendu] of cas) {
    const t = titreDeSite(brut);
    verifier(`« ${brut.slice(0, 50)} » → « ${attendu} »`, t === attendu, `obtenu « ${t} »`);
  }
}

console.log('\n4 · Le nom écrit dans l’adresse de la page');
{
  const N = (u) => nomDepuisAdresse(new URL(u));
  const t = N('https://www.tripadvisor.fr/Restaurant_Review-g187791-d1024375-Reviews-Da_Enzo_al_29-Rome_Lazio.html');
  verifier('Tripadvisor : nom et ville', t?.nom === 'Da Enzo Al 29' && t.ville === 'Rome', JSON.stringify(t));
  const t2 = N('https://www.tripadvisor.com/Attraction_Review-g189400-d198711-Reviews-or10-Acropolis-Athens_Attica.html');
  verifier('Tripadvisor : page 2 des avis', t2?.nom === 'Acropolis' && t2.ville === 'Athens', JSON.stringify(t2));
  verifier('Booking', N('https://www.booking.com/hotel/gr/electra-palace-athens.fr.html')?.nom === 'Electra Palace Athens');
  verifier('TheFork', N('https://www.thefork.fr/restaurant/da-enzo-al-29-r12345')?.nom === 'Da Enzo Al 29');
  verifier('Yelp', N('https://www.yelp.com/biz/taverna-platanos-athina-2')?.nom === 'Taverna Platanos Athina');
  verifier('Un site inconnu ne donne rien', N('https://www.exemple.com/fr/index.html') === null);
}

console.log('\n5 · Comparer des noms dans toutes les écritures');
{
  verifier('le grec survit à la normalisation', normaliser('Ακρόπολη') === 'ακροπολη');
  verifier('le japonais aussi', normaliser('金閣寺') === '金閣寺');
  verifier('accents retirés, ponctuation en espaces', normaliser("Café de l'Opéra") === 'cafe de l opera');
  const acropole = { name: 'Ακρόπολη Αθηνών', namedetails: { name: 'Ακρόπολη Αθηνών', 'name:en': 'Acropolis of Athens', 'name:fr': 'Acropole d’Athènes' } };
  verifier('nom latin retrouvé dans les variantes (name:en)', accordNom('Acropolis', nomsConnus(acropole)) === 'fort');
  verifier('nom français retrouvé (name:fr)', accordNom('Acropole d’Athènes', nomsConnus(acropole)) === 'fort');
  verifier('un nom vide ne « correspond » plus à tout', accordNom('', nomsConnus(acropole)) === null);
  verifier('un nom sans rapport ne correspond pas', accordNom('Taverna Platanos', nomsConnus(acropole)) === null);
  verifier('nom de 2 lettres : pas contenu dans la requête', accordNom('Bo Innovation Hong Kong', ['Bo']) === null);
  verifier('kanji court : contenu dans la requête', accordNom('金閣寺 京都', ['金閣寺']) === 'fort');
  verifier('un mot en commun : accord faible', accordNom('Taverna Platanos Plaka', ['Platanos']) === 'fort'
    && accordNom('Restaurante Botín', ['Sobrino de Botín']) === 'faible');
}

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
