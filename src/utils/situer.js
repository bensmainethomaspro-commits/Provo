/**
 * Un lien ou une légende a donné un NOM, sans point sur la carte : lequel des
 * lieux trouvés est-ce ?
 *
 * L'app cherchait « nom, destination » autour du voyage, prenait ce qui
 * sortait, et s'arrêtait là. Deux fautes, vues le 11 novembre 2026 sur un lien
 * de partage Google vers un restaurant de Rome collé dans un voyage à Biarritz :
 *
 *  · rien autour de Biarritz, donc « ce lieu n'est pas répertorié dans la carte
 *    ouverte » — il l'est, à Rome, et personne n'était allé voir ;
 *  · et un résultat UNIQUE était écrit dans la fiche sans qu'on vérifie qu'il
 *    porte le nom : un « La Cucina » de Biarritz aurait donné son adresse à un
 *    restaurant romain.
 *
 * L'ordre tenu ici, et il compte : le NOM ENTIER passe avant la proximité.
 *   1. un lieu qui porte ce nom près du voyage  → c'est lui ;
 *   2. sinon un lieu qui le porte ailleurs, s'il est SEUL à le porter → c'est
 *      lui, et l'écran dit où il est ;
 *   3. sinon ce qui ressemble est PROPOSÉ — jamais écrit d'office.
 *
 * Pur, sans réseau : vérifié par `scripts/verif-situer.mjs`.
 */
import { accordNom, normaliser, seulDeSonNom } from '../../supabase/functions/_shared/lecture-lien.ts';

/** Au-delà, un lieu n'est plus « là où se passe le voyage » (seuil du contrôle des lieux). */
export const LOIN_KM = 150;

export function kmEntre(aLat, aLon, bLat, bLon) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const situe = (c) => Number.isFinite(c?.lat) && Number.isFinite(c?.lon);
// Les variantes du nom quand le géocodeur les donne (`name:en`, `alt_name`…) :
// à Vienne, « Vienna State Opera » n'est écrit que là.
const nomsDe = (c) => (c?.noms?.length ? c.noms : [c?.title]).filter(Boolean);
const dansLeVoyage = (c, ancre) => !ancre || kmEntre(ancre.lat, ancre.lon, c.lat, c.lon) <= LOIN_KM;

/**
 * 1 · Près du voyage, un lieu qui porte le nom entier.
 *
 * @returns {{lieu: object|null, candidats: Array}} `candidats` quand plusieurs
 *   lieux distincts le portent (une chaîne, deux adresses) : à la personne de dire.
 */
export function fortPresDuVoyage(titre, trouves, ancre = null) {
  const forts = (trouves || []).filter(c => situe(c) && dansLeVoyage(c, ancre)
    && accordNom(titre, nomsDe(c)) === 'fort');
  if (!forts.length) return { lieu: null, candidats: [] };
  // Le même commerce ressort souvent deux fois, en point et en bâtiment : même
  // nom, à quelques dizaines de mètres. Deux adresses d'une même enseigne
  // peuvent être à 150 m l'une de l'autre — celles-là sont un vrai choix.
  const leMeme = (c) => kmEntre(forts[0].lat, forts[0].lon, c.lat, c.lon) <= 0.1
    && normaliser(c.title) === normaliser(forts[0].title);
  const distincts = forts.filter(c => !leMeme(c));
  if (!distincts.length) return { lieu: forts[0], candidats: [] };
  // Classés par `searchPlaces` : quand le premier détache nettement les
  // autres, faire choisir n'apporte rien.
  const net = (forts[0]._score ?? 0) - (distincts[0]._score ?? 0) >= 5;
  return net ? { lieu: forts[0], candidats: [] } : { lieu: null, candidats: forts };
}

/**
 * 2 · Ailleurs : le lieu qui est seul au monde à porter ce nom.
 *
 * @returns {{lieu: object|null, candidats: Array}} `candidats` : des homonymes
 *   à des endroits différents, à donner à choisir.
 */
export function fortAilleurs(titre, trouves) {
  const { lieux, portent } = seulDeSonNom(titre, (trouves || []).filter(situe).map(c => ({
    brut: c,
    noms: nomsDe(c),
    lat: c.lat, lon: c.lon,
    // `generic` de `searchPlaces` compte aussi les bâtiments, qui peuvent être
    // un musée ou un palais : seule une adresse nue est écartée ici.
    generique: Boolean(c.isAddress),
  })));
  if (lieux.length) return { lieu: lieux[0].brut, candidats: [] };
  return { lieu: null, candidats: portent.map(p => p.brut) };
}

/**
 * 3 · Ce qui reste à proposer : ce qui a été trouvé près du voyage, ce qui
 * partage un mot avec le nom d'abord. Jamais écrit d'office — un voisin n'est
 * pas le lieu.
 */
export function aProposer(titre, trouves, ancre = null, max = 4) {
  const proches = (trouves || []).filter(c => situe(c) && dansLeVoyage(c, ancre));
  const ressemble = (c) => (accordNom(titre, nomsDe(c)) ? 0 : 1);
  return [...proches].sort((a, b) => ressemble(a) - ressemble(b)).slice(0, max);
}

/**
 * Où est ce lieu, dit comme on le dirait : « Rome, Italie ». Les deux derniers
 * morceaux de l'adresse — la rue n'apprend rien à qui se demande si c'est loin.
 */
export function villeEtPays(adresse) {
  const bouts = String(adresse || '').split(',').map(s => s.trim()).filter(Boolean);
  return bouts.slice(-2).join(', ');
}

/**
 * La distance au voyage, seulement quand elle mérite d'être dite.
 * @returns {number|null} kilomètres, ou null si le lieu est dans le voyage
 */
export function loinDuVoyage(lieu, ancre) {
  if (!ancre || !situe(lieu) || !Number.isFinite(ancre.lat) || !Number.isFinite(ancre.lon)) return null;
  const d = kmEntre(ancre.lat, ancre.lon, lieu.lat, lieu.lon);
  return d > LOIN_KM ? d : null;
}
