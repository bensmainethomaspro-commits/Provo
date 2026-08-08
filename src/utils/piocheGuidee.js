import { ouvertMaintenant } from './reserveView';
import { haversineKm, getTimeSlots, timeToMin } from './helpers';

/**
 * « Il me reste trois heures, qu'est-ce que je fais ? »
 *
 * Ce n'est pas un itinéraire généré. Les planificateurs qui décident à la
 * place de l'utilisateur produisent des recommandations de surface — et le
 * principe du produit est l'inverse : **on pioche dans sa propre Réserve**.
 *
 * Cette fonction ne propose donc rien qui n'y soit déjà. Elle se contente
 * d'écarter ce qui ne colle pas à la situation — fermé, trop loin, trop long,
 * déjà au programme — et de remonter ce qui colle le mieux. L'utilisateur
 * choisit ; l'app lui évite seulement de relire trente fiches sous la pluie.
 *
 * Aucun appel réseau : tout est déjà là.
 */

// Ce qu'on peut raisonnablement rejoindre à pied depuis là où l'on est.
const PORTEE_KM = 3;
const VITESSE_MARCHE = 4.5;

/** Les catégories qui tiennent debout quand il pleut. */
const A_COUVERT = new Set(['visite', 'resto', 'shopping', 'fun', 'repos']);

// Codes Open-Meteo : 51+ = bruine, pluie, averses, neige, orage.
const ilPleut = (code) => Number.isFinite(code) && code >= 51;

const dureeMin = (a) => (a.durationHours || 0) * 60 + (a.durationMinutes || 0);

/**
 * Le temps qu'il reste avant la prochaine activité calée, ou avant la fin de
 * la journée. C'est la contrainte réelle : proposer une visite de trois heures
 * à quelqu'un qui a un opéra dans une heure ne sert à rien.
 */
export function tempsRestant(jour, maintenant = new Date()) {
  const FIN = 22 * 60;
  const t = maintenant.getHours() * 60 + maintenant.getMinutes();
  const slots = getTimeSlots(jour?.activities || [], jour?.startTime || '09:00');
  const prochaine = (jour?.activities || [])
    .filter(a => a?.fixedStart)
    .map(a => timeToMin(a.fixedStart))
    .filter(m => Number.isFinite(m) && m > t)
    .sort((x, y) => x - y)[0];
  // Une activité EN COURS repousse le moment où l'on est libre. Une activité
  // simplement prévue plus tard, non : la compter reviendrait à dire qu'on est
  // occupé jusqu'à la fin d'un opéra qui n'a pas commencé, donc qu'il ne reste
  // aucun temps libre avant lui.
  const finsEnCours = Object.values(slots)
    .map(s => ({ d: timeToMin(s.start), f: timeToMin(s.end) }))
    .filter(({ d, f }) => Number.isFinite(d) && Number.isFinite(f) && d <= t && f > t)
    .map(({ f }) => f);
  const libreA = finsEnCours.length ? Math.max(...finsEnCours) : t;
  const butoir = prochaine ?? FIN;
  return Math.max(0, butoir - Math.max(t, libreA));
}

/**
 * Ce qui, dans la Réserve, tient dans la situation actuelle.
 *
 * @param {object} trip
 * @param {object} jour — la journée en cours
 * @param {object} [opts]
 * @param {{lat:number,lon:number}} [opts.position] — où l'on est
 * @param {number} [opts.meteoCode] — code Open-Meteo du jour
 * @param {Date} [opts.maintenant]
 * @returns {{minutes:number, pluie:boolean, idees:Array, ecartees:number}}
 */
export function piocheGuidee(trip, jour, { position = null, meteoCode = null, maintenant = new Date() } = {}) {
  const minutes = tempsRestant(jour, maintenant);
  const pluie = ilPleut(meteoCode);
  const dejaLa = new Set((jour?.activities || []).filter(Boolean)
    .map(a => (a.title || '').trim().toLowerCase()));

  let ecartees = 0;
  const idees = (trip?.reserve || [])
    .filter(Boolean)
    .map(a => {
      // Fermé maintenant : c'est rédhibitoire, et c'est la seule chose qu'on
      // affirme — `ouvertMaintenant` rend `null` quand il ne sait pas, et un
      // horaire inconnu ne doit jamais faire écarter une bonne idée.
      if (ouvertMaintenant(a.openingHours, maintenant) === false) return null;
      if (dejaLa.has((a.title || '').trim().toLowerCase())) return null;

      // `tempsRestant` rend 0 quand il ne reste PLUS RIEN — pas « je ne sais
      // pas ». Le garde `minutes > 0` faisait donc sauter le filtre de durée
      // précisément au moment où il compte le plus : à 19 h, la veille d'un
      // opéra à 20 h, la pioche proposait une randonnée de neuf heures.
      // Zéro minute disponible, c'est zéro idée — et le dire est la bonne
      // réponse, pas une panne.
      const duree = dureeMin(a) || 60;
      if (duree > minutes) return null;

      let km = null, marche = 0;
      if (position && Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
        km = haversineKm(position.lat, position.lon, a.lat, a.lon);
        if (Number.isFinite(km)) {
          if (km > PORTEE_KM) return null;
          marche = Math.round((km / VITESSE_MARCHE) * 60);
          // Le trajet compte dans le temps disponible : aller-retour compris.
          if (duree + marche * 2 > minutes) return null;
        }
      }

      // Un score, pas un classement savant : plus c'est près, mieux c'est ;
      // et sous la pluie, ce qui est couvert passe devant.
      let score = 100 - (km != null ? km * 12 : 20);
      if (pluie) score += A_COUVERT.has(a.category) ? 25 : -40;
      if (a.mustDo) score += 15;

      return { activite: a, km, marche, duree, score };
    })
    .filter(x => { if (!x) { ecartees++; return false; } return true; })
    .sort((x, y) => y.score - x.score)
    .slice(0, 4);

  return { minutes, pluie, idees, ecartees };
}
