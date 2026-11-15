/**
 * Un carnet collé devient des fiches (`src/utils/carnet.js`).
 *
 * Demandé le 14 novembre 2026, avec un carnet de Venise en PDF : une page par
 * lieu — catégorie et quartier, nom, adresse, présentation, horaires, prix,
 * « bon à savoir ». `fixtures/carnet-venise.txt` en est un extrait de dix
 * pages, tel que le donne « tout sélectionner, copier » dans un lecteur de PDF
 * (le moteur de Firefox, pdf.js) : sans ligne vide, des capitales espacées
 * (« V I S I T E »), des noms et des phrases coupés par la mise en page.
 *
 * Ce qui compte le plus : la limite entre l'adresse et la présentation (une
 * mesure de la colonne prise sur le mauvais texte collait l'adresse au nom et
 * coupait sept pages sur trente-deux), et NE RIEN INVENTER — des horaires
 * « à vérifier » restent du texte, jamais un « Fermé » à tort.
 *
 * Usage :  node scripts/verif-carnet.mjs
 */
import { readFileSync } from 'node:fs';
import { casseDeTitre, horairesVersOsm, lireCarnet, montantDe, recoller } from '../src/utils/carnet.js';

let ok = 0, ko = 0;
const v = (nom, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nom}`); } else { ko++; console.log(`  ✗ ${nom} — ${detail}`); }
};
const J = JSON.stringify;

console.log('\n1 · Le carnet de Venise, copié depuis un lecteur de PDF');
const venise = lireCarnet(readFileSync(new URL('./fixtures/carnet-venise.txt', import.meta.url), 'utf8'));
const lieux = venise?.lieux || [];
const lieu = (titre) => lieux.find(l => l.title === titre) || {};
v('dix pages, dix lieux — le sommaire n’en est pas un', lieux.length === 10, J(lieux.map(l => l.title)));
v('les noms, recollés par-dessus la mise en page',
  J(lieux.map(l => l.title)) === J(['Basilique Saint-Marc', 'Palais des Doges & Pont des Soupirs', 'Traghetto', 'Murano',
    'Ristorante La Fornace', "Trattoria Ca' d'Oro alla Vedova", 'Antico Forno', 'Margaret Duchamp',
    'Gelateria Gallonetto', 'Al Gobbo di Rialto']), J(lieux.map(l => l.title)));
{
  const b = lieu('Basilique Saint-Marc');
  v('l’adresse à part, ni collée au nom ni à la présentation', b.address === 'Piazza San Marco', J(b.address));
  v('la présentation entière, d’une phrase à l’autre',
    b.description === "Joyau byzantin aux célèbres mosaïques dorées, sous cinq coupoles. La Pala d'Oro et le trésor se visitent en supplément.",
    J(b.description));
  v('les horaires tels qu’écrits', b.horairesTexte === 'Lun-sam 9h30 - 17h15\nDim 14h - 17h15', J(b.horairesTexte));
  v('… et pour « ouvert / fermé » : sûrs, donc traduits', b.openingHours === 'Mo-Sa 09:30-17:15; Su 14:00-17:15', J(b.openingHours));
  v('le prix tel qu’écrit, sur ses lignes', b.prixTexte === "≈ 3 € (6 € coupe-file en ligne)\nPala d'Oro + 5 €", J(b.prixTexte));
  v('… et son premier montant', b.price === '3', J(b.price));
  v('le « bon à savoir », sans le pied de page qui le suit',
    b.bonASavoir === 'Tenue correcte exigée : épaules et genoux couverts.', J(b.bonASavoir));
  v('catégorie et quartier, de l’en-tête de la page', b.category === 'visite' && b.quartier === 'San Marco & Rialto', J([b.category, b.quartier]));
}
v('un premier mot composé ne fait pas passer l’adresse dans la présentation (« Gondole-navette »)',
  lieu('Traghetto').address === 'Santa Sofia - Pescaria, près du Rialto', J(lieu('Traghetto').address));
v('… ni « Restaurant-pizzeria »', lieu('Al Gobbo di Rialto').address === 'San Polo 649, près du marché du Rialto',
  J(lieu('Al Gobbo di Rialto').address));
v('un nom propre coupé en fin de ligne reste dans la présentation',
  lieu('Margaret Duchamp').description === 'Bar très vivant et populaire sur le Campo Santa Margherita, rendez-vous des étudiants, ouvert tard le soir.',
  J(lieu('Margaret Duchamp').description));
v('une île : une balade, dans la rubrique « Les Îles de la Lagune »',
  lieu('Murano').category === 'balade' && lieu('Murano').quartier === 'Les Îles de la Lagune', J([lieu('Murano').category, lieu('Murano').quartier]));
v('un restaurant : son quartier, de « RESTAURANT · MURANO » en capitales espacées',
  lieu('Ristorante La Fornace').category === 'resto' && lieu('Ristorante La Fornace').quartier === 'Murano', J(lieu('Ristorante La Fornace')));
{
  const t = lieu("Trattoria Ca' d'Oro alla Vedova");
  v('« Midi et soir, fermé le jeudi (à vérifier) » : du texte, aucun horaire machine',
    t.horairesTexte === 'Midi et soir\nFermé le jeudi (à vérifier)' && !('openingHours' in t), J(t));
}
v('une semaine qui passe par le dimanche, minuit compris',
  lieu('Gelateria Gallonetto').openingHours === 'Su-Th 10:30-22:30; Fr-Sa 10:30-24:00', J(lieu('Gelateria Gallonetto').openingHours));
v('un prix « Budget élevé » n’a pas de montant', !('price' in (lireCarnet(`EN-TÊTE · A 01 / 02
VISITE
Lieu Un
Rue Un
Une phrase qui présente ce lieu.
PRIX
Budget élevé
Supplément ≈ 6 €
EN-TÊTE · A 02 / 02
VISITE
Lieu Deux
Rue Deux
Une autre phrase.
PRIX
12 €`)?.lieux[0] || { price: 'absent' })), 'le supplément a été pris pour le prix');

console.log('\n2 · Le même carnet, extrait avec des lignes vides (pdftotext)');
{
  // Pages telles que pdftotext les rend : blocs séparés, légende de photo
  // glissée entre le nom et l'adresse, tuiles « HORAIRES | PRIX » lues titre
  // après titre, capitales espacées sans plus d'espace entre les mots.
  const BRUT = `RESTAURANTS & BARS

17 / 33

Arrivée à Murano Colonna

R E S TA U R A N T · M U R A N O

Ristorante La
Fornace

Illustration : pâtes de la mer

Fondamenta Manin 1, Murano

Tout au début de l'île, à l'arrêt Colonna : pâtes aux fruits
de mer frais en terrasse face à la lagune.
HORAIRES

PRIX

Midi et soir
Jours à vérifier

30 - 50 €

Bon à savoir · À 2 minutes du ponton Colonna en descendant du
vaporetto.

Infos indicatives (nov. 2026), à vérifier avant d'y aller

Venise
\fRESTAURANTS & BARS

19 / 33

Illustration : pizza al taglio

P I Z Z A A L TAG L I O · S A N P O LO

Antico Forno

Les ruelles du Rialto

Ruga Rialto 973, San Polo

Excellente pizza al taglio à emporter, parfaite pour un
déjeuner rapide sur le pouce près du Rialto.
HORAIRES

Tous les jours 11h30 21h30

PRIX

5 - 12 €
La part ≈ 3 - 5 €

Bon à savoir · Surtout à emporter : peu de places assises.

Infos indicatives (nov. 2026), à vérifier avant d'y aller

Venise
`;
  const [f, a] = lireCarnet(BRUT)?.lieux || [];
  v('deux pages, deux lieux', f && a, J(lireCarnet(BRUT)));
  v('la légende de photo laissée de côté', f?.title === 'Ristorante La Fornace' && f?.address === 'Fondamenta Manin 1, Murano'
    && !String(f?.description).includes('Illustration'), J(f));
  v('tuiles côte à côte : chacune garde son contenu',
    f?.horairesTexte === 'Midi et soir\nJours à vérifier' && f?.prixTexte === '30 - 50 €', J([f?.horairesTexte, f?.prixTexte]));
  v('« S A N P O LO » : l’espace retrouvé dans l’adresse', a?.quartier === 'San Polo', J(a?.quartier));
  v('« P I Z Z A A L TAG L I O » : un resto', a?.category === 'resto', J(a?.category));
  v('« 11h30 21h30 » (le tiret perdu) : du texte, pas d’horaire deviné', a?.horairesTexte === 'Tous les jours 11h30 21h30' && !a?.openingHours, J(a));
  v('le pied de page n’entre dans aucun champ', !J([f, a]).includes('Infos indicatives') && !J([f, a]).includes('Venise"'), J([f, a]));
}

console.log('\n3 · Un carnet écrit à la main (titres et libellés)');
{
  const MD = `# Lisbonne — mes idées

## Alfama

### Castelo de São Jorge
Visite · Alfama
Château maure qui domine la ville, avec la plus belle vue sur le Tage.
📍 Rua de Santa Cruz do Castelo
🕐 Tous les jours 9h - 21h
💶 15 €
💡 Arriver à l'ouverture, avant les groupes.

### Tasca do Chico
**Adresse :** Rua do Diário de Notícias 39
**Horaires :** Tous les jours 19h - 3h
**Prix :** 20 - 30 €
**Bon à savoir :** Fado tous les soirs, pas de réservation.

## Belém

### Pastéis de Belém
- Adresse : Rua de Belém 84
- Horaires : Tous les jours 8h - 23h
- Prix : 1,40 € le pastel
`;
  const r = lireCarnet(MD)?.lieux || [];
  v('trois lieux', r.length === 3, J(r.map(l => l.title)));
  const [c, t, p] = r;
  v('emojis : adresse, horaires, prix, bon à savoir',
    c?.address === 'Rua de Santa Cruz do Castelo' && c?.openingHours === 'Mo-Su 09:00-21:00' && c?.price === '15'
    && c?.bonASavoir === "Arriver à l'ouverture, avant les groupes.", J(c));
  v('« Visite · Alfama » sous le nom : catégorie et quartier', c?.category === 'visite' && c?.quartier === 'Alfama', J(c));
  v('la présentation, ligne libre', c?.description?.startsWith('Château maure'), J(c?.description));
  v('libellés en gras', t?.address === 'Rua do Diário de Notícias 39' && t?.prixTexte === '20 - 30 €'
    && t?.bonASavoir === 'Fado tous les soirs, pas de réservation.', J(t));
  v('« 19h - 3h » : après minuit, sans erreur', t?.openingHours === 'Mo-Su 19:00-03:00', J(t?.openingHours));
  v('un titre seul ouvre une rubrique : le quartier des suivants', t?.quartier === 'Alfama' && p?.quartier === 'Belém', J([t?.quartier, p?.quartier]));
  v('libellés en liste, prix à virgule', p?.address === 'Rua de Belém 84' && p?.price === '1.4', J(p));
  v('« Tasca do Chico », sans genre écrit : une visite par défaut, rien d’inventé', t?.category === 'visite', J(t?.category));

  // Rangé par rubrique plutôt que par quartier.
  const R = lireCarnet(`## Restaurants

### Cervejaria Ramiro
Adresse : Av. Almirante Reis 1
Prix : 30 - 40 €

### Taberna da Rua das Flores
Adresse : Rua das Flores 103

## Musées

### Museu Nacional do Azulejo
Adresse : Rua da Madre de Deus 4
Ouverture : Mar-dim 10h - 18h
Budget : 8 €
`)?.lieux || [];
  v('« ## Restaurants » est une rubrique, pas un quartier',
    J(R.map(l => [l.category, l.quartier || ''])) === J([['resto', ''], ['resto', ''], ['visite', '']]), J(R.map(l => [l.title, l.category, l.quartier])));
  v('« Ouverture : », « Budget : » se lisent comme horaires et prix', R[2]?.openingHours === 'Tu-Su 10:00-18:00' && R[2]?.price === '8', J(R[2]));
  const Q = lireCarnet(`## Alfama
### Restaurants
**Tasca do Chico**
Adresse : Rua do Diário de Notícias 39
**Pastelaria Alfama**
Adresse : Rua X 2
## Belém
**Mosteiro dos Jerónimos**
Adresse : Praça do Império
`)?.lieux || [];
  v('quartier puis rubrique : les deux tiennent ; un nouveau quartier efface la rubrique',
    J(Q.map(l => [l.category, l.quartier])) === J([['resto', 'Alfama'], ['resto', 'Alfama'], ['visite', 'Belém']]), J(Q.map(l => [l.title, l.category, l.quartier])));
}

console.log('\n4 · Ce qui n’est pas un carnet');
for (const [nom, texte] of [
  ['un lieu et son lien', 'Taverna Platanos\nhttps://maps.app.goo.gl/AbCdEf123 à tester absolument ce soir'],
  ['une adresse sur trois lignes', 'Ristorante da Mario\nVia Roma 12\n00100 Roma, Italie — réservé pour vendredi soir'],
  ['une légende de vidéo', 'Les 3 meilleurs restos de Lisbonne 🇵🇹\n1. Tasca do Chico\n2. Cervejaria Ramiro\n3. Taberna da Rua das Flores\n#lisbonne #food'],
  ['une confirmation de réservation', 'Confirmation de réservation\nNuméro de dossier : ABC123\n1. Vol AF1234\nHoraires : 10h05 - 12h20\nPrix : 230 €\n2. Hôtel Le Lido\nAdresse : 12 rue X, Nice\nPrix : 120 €'],
  ['une seule page de carnet', readFileSync(new URL('./fixtures/carnet-venise.txt', import.meta.url), 'utf8').split('VISITES · SAN MARCO & RIALTO 03 / 33')[0].split('\n').slice(8).join('\n')],
  ['une ligne', 'Basilique Saint-Marc, Venise'],
  ['rien', ''],
]) {
  v(nom, lireCarnet(texte) === null, J(lireCarnet(texte)));
}

console.log('\n5 · Les horaires : traduits seulement quand c’est sûr');
for (const [lignes, attendu] of [
  [['Lun-sam 9h30 - 17h15', 'Dim 14h - 17h15'], 'Mo-Sa 09:30-17:15; Su 14:00-17:15'],
  [['Tous les jours 9h30 - 17h30', 'Dernière entrée 17h'], 'Mo-Su 09:30-17:30'],
  [['Mar-dim 8h15 - 19h15', 'Fermé le lundi'], 'Tu-Su 08:15-19:15'],
  [['12h - 14h45 et 19h - 21h45'], 'Mo-Su 12:00-14:45,19:00-21:45'],
  [['Accès libre 24h/24'], '24/7'],
  [['Tous les jours 9h - 18h', 'Fermé le lundi'], null],
  [['Lun-sam ≈ 7h30 - 20h'], null],
  [['9h - 19h', 'Variable selon la saison'], null],
  [['10h - 18h', 'Fermé 13h30 - 14h'], null],
  [['Lun 17h - minuit', 'Mar-dim 12h - minuit (1h ven-sam)'], null],
  [['Midi et soir'], null],
  [['Basilique : 10h30 - 18h (mars-oct)'], null],
  [[], null],
]) {
  v(`${J(lignes)} → ${attendu}`, horairesVersOsm(lignes) === attendu, J(horairesVersOsm(lignes)));
}

console.log('\n6 · Petits outils');
v('montant : le premier', montantDe('≈ 10 - 25 € (estimation)') === 10 && montantDe('Vaporetto 9,50 € l’aller') === 9.5);
v('montant : aucun', montantDe('Entrée libre') === null && montantDe('Budget élevé') === null);
v('casse de titre', casseDeTitre('SAN POLO & GRAND CANAL') === 'San Polo & Grand Canal' && casseDeTitre("CA' D'ORO") === "Ca' D'Oro",
  casseDeTitre("CA' D'ORO"));
v('recoller : « Saint- » + « Marc », « 7h30 - » + « 12h »',
  J(recoller(['Basilique Saint-', 'Marc'])) === '["Basilique Saint-Marc"]'
  && J(recoller(['Poissons : mar-sam 7h30 -', '12h'])) === '["Poissons : mar-sam 7h30 - 12h"]', J(recoller(['Basilique Saint-', 'Marc'])));
v('recoller : deux lignes d’horaires restent deux', J(recoller(['Lun-sam 9h30 - 17h15', 'Dim 14h - 17h15'])) === '["Lun-sam 9h30 - 17h15","Dim 14h - 17h15"]');
v('recoller : « jusqu’à » appelle la suite', J(recoller(["Mar-sam dès 18h, jusqu'à", '1h - 2h'])) === `["Mar-sam dès 18h, jusqu'à 1h - 2h"]`);

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
