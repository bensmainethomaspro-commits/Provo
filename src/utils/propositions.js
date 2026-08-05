import { ouvertMaintenant } from './reserveView';
import { haversineKm, getTimeSlots, timeToMin } from './helpers';

/**
 * Ce que l'app doit dire quand on pose une activité dans une journée.
 *
 * Principe produit : sur place, on ne veut ni *chercher* (les horaires, la
 * distance) ni *réfléchir* (est-ce que ça tient ?). L'app a déjà ces
 * informations — elle doit les dire au moment du geste, pas les laisser
 * découvrir devant une porte fermée.
 *
 * Elle **propose**, elle ne réorganise rien et ne bloque rien : l'activité est
 * posée d'abord, le signal vient après, et il reste toujours possible de ne
 * rien changer.
 */

// Au-delà, la journée n'en est plus une. Seuil volontairement tardif : on
// signale ce qui déborde vraiment, pas ce qui remplit.
const FIN_DE_JOURNEE = 22 * 60;
// En ville, au-delà, ce n'est plus le même quartier ni le même trajet.
const LOIN_KM = 12;

/**
 * Ce lieu ouvre-t-il à un moment de cette journée-là ?
 *
 * Réutilise le lecteur d'horaires déjà éprouvé plutôt que d'en écrire un
 * second : on l'interroge heure par heure. Rend `null` — « on ne sait pas » —
 * dès qu'aucune règle ne couvre ce jour. Annoncer « fermé » à tort ferait
 * renoncer à un lieu ouvert, ce qui est bien pire que de se taire.
 *
 * @returns {boolean|null}
 */
export function ouvertDansLaJournee(horaires, date) {
  if (!(horaires || '').trim()) return null;
  let vuFerme = false;
  for (let h = 8; h <= 21; h++) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(h, 0, 0, 0);
    const r = ouvertMaintenant(horaires, d);
    if (r === true) return true;
    if (r === false) vuFerme = true;
  }
  return vuFerme ? false : null;
}

const estAujourdhui = (date, maintenant) => {
  const d = new Date(date);
  return !Number.isNaN(d.getTime())
    && d.getFullYear() === maintenant.getFullYear()
    && d.getMonth() === maintenant.getMonth()
    && d.getDate() === maintenant.getDate();
};

const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Les signaux à donner pour cette activité, dans cette journée.
 *
 * @param {object} activite — celle qu'on vient de poser
 * @param {object} jour — la journée d'accueil, activité comprise ou non
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.feries] — `{ '2026-08-15': 'Assomption' }`
 * @returns {Array<{cle: string, icone: string, texte: string}>} vide = rien à dire
 */
export function signauxAjout(activite, jour, { maintenant = new Date(), feries = null } = {}) {
  const out = [];
  if (!activite || !jour) return out;
  const autres = (jour.activities || []).filter(a => a && a.id !== activite.id);

  // ── Fermé ─────────────────────────────────────────────────────────────────
  const aujourdhui = estAujourdhui(jour.date, maintenant);
  const ouvert = aujourdhui
    ? ouvertMaintenant(activite.openingHours, maintenant)
    : ouvertDansLaJournee(activite.openingHours, jour.date);
  if (ouvert === false) {
    out.push({
      cle: 'ferme', icone: '🚪',
      texte: aujourdhui ? "C'est fermé en ce moment." : 'C\'est fermé ce jour-là.',
    });
  }

  // ── Jour férié ────────────────────────────────────────────────────────────
  // Les horaires OpenStreetMap portent une règle « PH » que le lecteur ne sait
  // pas résoudre faute de calendrier : un lieu peut donc paraître ouvert un
  // jour de fermeture nationale. On ne prétend pas savoir si CE lieu ferme —
  // on dit ce qui est vrai et vérifiable, et on laisse juger.
  const ferie = feries?.[String(jour.date || '').slice(0, 10)];
  if (ferie && ouvert !== true) {
    out.push({
      cle: 'ferie', icone: '📅',
      texte: `C'est un jour férié (${ferie}) — beaucoup de lieux ferment.`,
    });
  }

  // ── Ça ne rentre pas ──────────────────────────────────────────────────────
  const avec = [...autres, activite];
  const slots = getTimeSlots(avec, jour.startTime || '09:00');
  const fins = Object.values(slots).map(s => timeToMin(s.end)).filter(Number.isFinite);
  const fin = fins.length ? Math.max(...fins) : null;
  if (fin != null && fin > FIN_DE_JOURNEE) {
    out.push({
      cle: 'temps', icone: '⏳',
      texte: `Avec ça, la journée finirait à ${hhmm(fin)}.`,
    });
  }

  // ── C'est loin ────────────────────────────────────────────────────────────
  const situees = autres.filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lon));
  if (Number.isFinite(activite.lat) && Number.isFinite(activite.lon) && situees.length) {
    let plusProche = null;
    for (const a of situees) {
      const km = haversineKm(activite.lat, activite.lon, a.lat, a.lon);
      if (!Number.isFinite(km)) continue;
      if (!plusProche || km < plusProche.km) plusProche = { km, titre: a.title };
    }
    if (plusProche && plusProche.km >= LOIN_KM) {
      const d = plusProche.km >= 10 ? Math.round(plusProche.km) : plusProche.km.toFixed(1).replace('.', ',');
      out.push({
        cle: 'loin', icone: '📍',
        texte: `À ${d} km du reste de la journée (${plusProche.titre}).`,
      });
    }
  }

  return out;
}
