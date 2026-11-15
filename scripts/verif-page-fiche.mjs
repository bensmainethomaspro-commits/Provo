/**
 * La fiche ouverte, « page du carnet » : ce qu'elle donne à lire.
 *
 * Demandé le 14 novembre 2026. Les horaires s'affichaient au format de la
 * carte ouverte (« Mo-Sa 09:30-17:15; Su 14:00-17:15 »), la présentation gardée
 * par la fiche ne s'affichait nulle part, et rien ne disait « fermé le jeudi ».
 *
 * Ce qui compte le plus ici : NE RIEN INVENTER. Une règle d'horaires qu'on ne
 * lit pas avec certitude se montre telle quelle ; un « bon à savoir » n'existe
 * que si la fiche sait quelque chose.
 *
 * Usage :  node scripts/verif-page-fiche.mjs
 */
import { faitsDepuisEtiquettes, horairesLisibles, pageDeFiche } from '../src/utils/pageFiche.js';

let ok = 0, ko = 0;
const v = (nom, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nom}`); } else { ko++; console.log(`  ✗ ${nom} — ${detail}`); }
};
const J = JSON.stringify;
const lignes = (h) => horairesLisibles(h)?.lignes.join(' / ') ?? null;
const dites = (p) => p.horaires.map(b => [b.quand, b.creneaux.join(', ')].filter(Boolean).join(' ')).join(' / ');

console.log('\n1 · Les horaires se lisent en français');
v('du lundi au samedi, puis le dimanche',
  lignes('Mo-Sa 09:30-17:15; Su 14:00-17:15') === 'Lun–sam 9h30–17h15 / Dim 14h–17h15', lignes('Mo-Sa 09:30-17:15; Su 14:00-17:15'));
v('tous les jours', lignes('Mo-Su 09:00-23:00') === 'Tous les jours 9h–23h', lignes('Mo-Su 09:00-23:00'));
v('sans jours : tous les jours', lignes('11:30-21:30') === 'Tous les jours 11h30–21h30', lignes('11:30-21:30'));
v('24 h/24', lignes('24/7') === 'Ouvert 24 h/24');
v('deux services', lignes('Mo-Su 12:00-14:30,19:00-22:30') === 'Tous les jours 12h–14h30, 19h–22h30', lignes('Mo-Su 12:00-14:30,19:00-22:30'));
v('jusqu’à minuit', lignes('Mo-Su 17:30-24:00') === 'Tous les jours 17h30–minuit', lignes('Mo-Su 17:30-24:00'));
v('deux jours qui se suivent', lignes('Sa,Su 10:00-18:00') === 'Sam, dim 10h–18h', lignes('Sa,Su 10:00-18:00'));
v('une semaine qui passe par le dimanche (Fr-Mo)',
  lignes('Fr-Mo 10:00-18:00') === 'Lun 10h–18h / Ven–dim 10h–18h', lignes('Fr-Mo 10:00-18:00'));
v('une règle plus loin remplace la précédente',
  lignes('Mo-Su 09:00-18:00; Fr 09:00-21:00') === 'Lun–jeu 9h–18h / Ven 9h–21h / Sam, dim 9h–18h', lignes('Mo-Su 09:00-18:00; Fr 09:00-21:00'));

console.log('\n2 · Les jours de fermeture se déduisent, sans se deviner');
{
  const h = horairesLisibles('Mo-We,Fr-Su 11:30-14:30,18:30-22:30');
  v('le jeudi manque : fermé le jeudi', J(h?.fermes) === '["jeudi"]', J(h));
  v('… et les lignes sautent ce jour', h?.lignes.join(' / ') === 'Lun–mer 11h30–14h30, 18h30–22h30 / Ven–dim 11h30–14h30, 18h30–22h30', J(h?.lignes));
  v('deux services : deux créneaux distincts', J(h?.blocs[0].creneaux) === '["11h30–14h30","18h30–22h30"]', J(h?.blocs));
  const off = horairesLisibles('Tu-Su 10:00-18:00; Mo off');
  v('« Mo off » : fermé le lundi', J(off?.fermes) === '["lundi"]' && off.lignes.join() === 'Mar–dim 10h–18h', J(off));
  v('jours fériés fermés', horairesLisibles('Mo-Su 09:00-17:00; PH off')?.feries === true);
  v('jours fériés avec horaires : ignorés, pas inventés', horairesLisibles('Mo-Su 09:00-17:00; PH 10:00-14:00')?.feries === false);
}

console.log('\n3 · Ce qu’on ne lit pas avec certitude n’est pas traduit');
for (const h of ['Apr-Oct: Mo-Su 09:00-19:00', 'Mo-Su sunrise-sunset', 'Mo-Fr 09:00-17:00 "sur rendez-vous"',
  'Mo-Su 09:00+', 'Midi et soir', 'Lun-sam 9h30 - 17h15', 'Xx-Yy 09:00-10:00', 'Mo off', '']) {
  v(`rendu tel quel : « ${h || '(vide)'} »`, horairesLisibles(h) === null, J(horairesLisibles(h)));
}

console.log('\n4 · Les faits de la carte ouverte qui valent d’être dits');
v('réservation obligatoire', J(faitsDepuisEtiquettes({ reservation: 'required' })) === '["reservation-requise"]');
v('réservation conseillée', J(faitsDepuisEtiquettes({ reservation: 'recommended' })) === '["reservation-conseillee"]');
v('espèces uniquement (cartes refusées)', J(faitsDepuisEtiquettes({ 'payment:cash': 'yes', 'payment:credit_cards': 'no' })) === '["especes"]');
v('espèces ET cartes : rien à dire', J(faitsDepuisEtiquettes({ 'payment:cash': 'yes', 'payment:credit_cards': 'yes' })) === '[]');
v('entrée gratuite', J(faitsDepuisEtiquettes({ fee: 'no' })) === '["gratuit"]');
v('terrasse, fauteuil, toilettes : pas un « bon à savoir »',
  J(faitsDepuisEtiquettes({ outdoor_seating: 'yes', wheelchair: 'yes', toilets: 'yes', internet_access: 'wlan' })) === '[]');
v('aucune étiquette', J(faitsDepuisEtiquettes()) === '[]');

console.log('\n5 · La page');
{
  const p = pageDeFiche({
    title: 'Basilique Saint-Marc', category: 'visite', quartier: 'San Marco',
    description: 'Joyau byzantin aux célèbres mosaïques dorées.', notes: 'Y aller tôt',
    openingHours: 'Mo-Sa 09:30-17:15; Su 14:00-17:15', price: '3',
    photoCredit: 'Zairon · CC BY-SA 4.0',
  }, { libelle: 'Visite', prix: n => `${n} €` });
  v('surtitre : catégorie et quartier', p.surtitre === 'Visite · San Marco', p.surtitre);
  v('la présentation du lieu, et la note à part', p.presentation.startsWith('Joyau') && p.notes === 'Y aller tôt', J(p));
  v('horaires lisibles', dites(p) === 'Lun–sam 9h30–17h15 / Dim 14h–17h15', J(p.horaires));
  v('… découpés : les jours, puis chaque créneau', J(p.horaires[0]) === '{"quand":"Lun–sam","creneaux":["9h30–17h15"]}', J(p.horaires[0]));
  v('prix', p.prix === '3 €', p.prix);
  v('rien à savoir de plus : pas de « bon à savoir »', p.bon.length === 0, J(p.bon));
  v('le crédit de la photo', p.credit === 'Zairon · CC BY-SA 4.0');
}
{
  const p = pageDeFiche({ title: 'Ca’ d’Oro alla Vedova', notes: 'Vu chez @bonjouravery : nero di seppia',
    openingHours: 'Mo-We,Fr-Su 11:30-14:30,18:30-22:30', faits: ['reservation-requise'] }, { libelle: 'Resto' });
  v('sans présentation, la note en tient lieu — une seule fois', p.presentation.startsWith('Vu chez') && p.notes === '', J(p));
  v('bon à savoir : réservation, puis jour de fermeture',
    J(p.bon) === '["Réservation obligatoire","Fermé le jeudi"]', J(p.bon));
  v('pas de prix : pas de tuile', p.prix === '');
  v('pas de quartier : la catégorie seule', p.surtitre === 'Resto');
  const carte = pageDeFiche({ title: 'Da Enzo al 29', secteurs: { neighbourhood: 'Trastevere', suburb: 'Municipio Roma I' } }, { libelle: 'Resto' });
  v('le quartier de la carte, le plus local', carte.surtitre === 'Resto · Trastevere', carte.surtitre);
  const range = pageDeFiche({ title: 'Louvre', secteurs: { quarter: "Saint-Germain-l'Auxerrois", suburb: 'Paris 1er Arrondissement' } },
    { libelle: 'Visite', quartier: 'Paris 1er Arrondissement' });
  v('… ou celui que la Réserve a choisi pour tout le voyage', range.surtitre === 'Visite · Paris 1er Arrondissement', range.surtitre);
}
{
  const p = pageDeFiche({ title: 'Antico Forno', openingHours: 'Midi et soir', prixTexte: '5 - 12 €', price: '5',
    bonASavoir: 'Surtout à emporter : peu de places assises.' });
  v('des horaires écrits à la main restent tels quels', dites(p) === 'Midi et soir' && p.horaires[0].quand === '', J(p.horaires));
  v('le prix écrit dans un carnet passe avant le montant', p.prix === '5 - 12 €');
  v('le « bon à savoir » d’un carnet, sans son point final', J(p.bon) === '["Surtout à emporter : peu de places assises"]', J(p.bon));
}
{
  const p = pageDeFiche({ title: 'Pont du Rialto', openingHours: '24/7', faits: ['gratuit'] });
  v('accès libre : « Gratuit » dans le prix, pas dans le « bon à savoir »', p.prix === 'Gratuit' && p.bon.length === 0, J(p));
  const semaine = pageDeFiche({ title: 'X', openingHours: 'Sa,Su 10:00-18:00' });
  v('cinq jours fermés : les horaires le disent, pas une phrase', semaine.bon.length === 0, J(semaine.bon));
  const vide = pageDeFiche({ title: 'Lieu nu' });
  v('une fiche nue ne montre aucun cadre vide',
    !vide.presentation && !vide.horaires.length && !vide.prix && !vide.bon.length && !vide.credit && !vide.surtitre, J(vide));
}

console.log('\n6 · Une fiche venue d’un carnet');
{
  const p = pageDeFiche({
    title: 'Scuola Grande di San Rocco', quartier: 'San Polo & Dorsoduro',
    horairesTexte: 'Tous les jours 9h30 - 17h30\nDernière entrée 17h', openingHours: 'Mo-Su 09:30-17:30',
    prixTexte: '12 € plein tarif\nRéduit 10 €', price: '12',
  }, { libelle: 'Visite' });
  v('les horaires tels que le carnet les écrit, nuance comprise',
    dites(p) === 'Tous les jours 9h30 - 17h30 / Dernière entrée 17h', J(p.horaires));
  v('… en texte qui revient à la ligne', p.horaires.every(b => b.texte), J(p.horaires));
  v('le prix du carnet, sur ses deux lignes', p.prix === '12 € plein tarif\nRéduit 10 €', J(p.prix));
  v('un prix en phrases : les tuiles l’une sous l’autre', p.larges === true);
  const g = pageDeFiche({ title: 'Gallerie dell’Accademia', horairesTexte: 'Mar-dim 8h15 - 19h15\nFermé le lundi',
    openingHours: 'Tu-Su 08:15-19:15' });
  v('« Fermé le lundi » dit une fois, par le carnet, pas redit en « bon à savoir »',
    dites(g) === 'Mar-dim 8h15 - 19h15 / Fermé le lundi' && g.bon.length === 0, J(g));
  const verifie = pageDeFiche({ title: 'Osteria da Alberto', horairesTexte: 'Midi et soir\nFermé le dimanche (à vérifier)',
    openingHours: 'Mo-Sa 12:00-15:00,18:30-22:30' });
  v('« à vérifier » puis la carte sait : ses horaires font foi',
    dites(verifie) === 'Lun–sam 12h–15h, 18h30–22h30' && J(verifie.bon) === '["Fermé le dimanche"]', J(verifie));
  const change = pageDeFiche({ title: 'Basilique', prixTexte: '≈ 3 € (6 € coupe-file en ligne)', price: 6 },
    { prix: n => `${n} €` });
  v('un montant changé à la main remplace le prix du carnet', change.prix === '6 €', J(change.prix));
  const budget = pageDeFiche({ title: 'Caffè Florian', prixTexte: 'Budget élevé\nSupplément orchestre ≈ 6 - 7 €', price: 0 });
  v('« Budget élevé » reste dit, même sans montant', budget.prix.startsWith('Budget élevé'), J(budget.prix));
  const libre = pageDeFiche({ title: 'Pont', prixTexte: 'Gratuit', price: 0 });
  v('« Gratuit » du carnet, montant nul', libre.prix === 'Gratuit', J(libre.prix));
  const court = pageDeFiche({ title: 'Antico Forno', openingHours: 'Mo-Su 11:30-21:30', price: '5' });
  v('des horaires de la carte et un petit prix : côte à côte', court.larges === false, J(court));
  const illisible = pageDeFiche({ title: 'X', openingHours: 'Apr-Oct: Mo-Su 09:00-19:00' });
  v('une règle de la carte qu’on ne lit pas revient à la ligne aussi', illisible.horaires[0].texte === true);
}

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
