/**
 * Ce que la fiche ouverte donne à lire : la « page du carnet ».
 *
 * Demandé le 14 novembre 2026, carnet de Venise à l'appui : une page par lieu,
 * avec sa présentation, ses horaires et son prix écrits pour être lus, et un
 * « bon à savoir ». La fiche montrait jusque-là les horaires au format de la
 * carte ouverte (« Mo-Sa 09:30-17:15; Su 14:00-17:15 ») et ne montrait pas du
 * tout la présentation qu'elle gardait pourtant.
 *
 * Tout est pur : aucune requête, aucune date du jour. Ce qui ne se lit pas
 * avec certitude n'est pas deviné — la fiche montre alors le texte tel quel.
 */

import { quartierDe } from './quartiers.js';
import { horairesVersOsm, montantDe } from './carnet.js';

const JOURS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const COURTS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const LONGS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const indexDuJour = (s) => JOURS.findIndex(j => j.toLowerCase() === String(s).trim().toLowerCase());
const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** « 09:30 » → « 9h30 », « 17:00 » → « 17h », « 24:00 » → « minuit ». */
function heure(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 24 || min > 59) return null;
  if ((h === 24 || h === 0) && min === 0) return 'minuit';
  return min ? `${h}h${m[2]}` : `${h}h`;
}

/** « Mo-We,Fr » → [0, 1, 2, 4]. `null` si un morceau ne se lit pas. */
function joursDe(texte) {
  const jours = new Set();
  for (const bloc of texte.split(',')) {
    const b = bloc.trim();
    if (!b || /^PH$/i.test(b)) continue;
    const plage = /^([A-Za-z]{2})\s*-\s*([A-Za-z]{2})$/.exec(b);
    if (plage) {
      const d = indexDuJour(plage[1]), f = indexDuJour(plage[2]);
      if (d < 0 || f < 0) return null;
      for (let k = 0; k < 7; k++) {
        const i = (d + k) % 7;
        jours.add(i);
        if (i === f) break;
      }
    } else {
      const i = indexDuJour(b);
      if (i < 0) return null;
      jours.add(i);
    }
  }
  return [...jours];
}

/**
 * Les horaires de la carte ouverte, dits en français.
 *
 *   « Mo-Sa 09:30-17:15; Su 14:00-17:15 » → Lun–sam 9h30–17h15 / Dim 14h–17h15
 *   « Mo-We,Fr-Su 12:00-14:30,19:00-22:30 » → … et « jeudi » dans `fermes`
 *
 * `blocs` porte la même chose que `lignes`, découpée : les jours d'un côté,
 * chaque créneau de l'autre — une tuile étroite coupe alors la ligne ENTRE
 * deux créneaux, jamais au milieu de « 9h30–17h15 ».
 *
 * @returns {{lignes: string[], blocs: Array<{quand: string, creneaux: string[]}>,
 *            fermes: string[], feries: boolean}|null}
 *   `null` quand la règle sort de ce qu'on lit avec certitude (saisons,
 *   « sunrise », commentaires…) : l'appelant montre alors le texte d'origine.
 */
export function horairesLisibles(horaires) {
  const src = String(horaires || '').trim();
  if (!src) return null;
  const rendre = (blocs, fermes, feries) => ({
    blocs, fermes, feries,
    lignes: blocs.map(b => [b.quand, b.creneaux.join(', ')].filter(Boolean).join(' ')),
  });
  if (/^24\/7$/i.test(src)) return rendre([{ quand: '', creneaux: ['Ouvert 24 h/24'] }], [], false);

  // Ce que chaque jour vaut, une fois toutes les règles lues : des créneaux,
  // « off », ou rien (aucune règle n'en parle). Une règle plus loin dans la
  // liste remplace la précédente pour les mêmes jours — c'est la convention.
  const parJour = new Array(7).fill(undefined);
  let feries = false, lu = false;

  for (const regle of src.split(';')) {
    const r = regle.trim();
    if (!r) continue;
    if (/^PH\b/i.test(r)) {
      if (/\b(off|closed)\s*$/i.test(r)) feries = true;
      continue;
    }
    const m = /^((?:[A-Za-z]{2}\s*[-,]\s*)*[A-Za-z]{2})\s+(.+)$/.exec(r);
    const joursTxt = m ? m[1] : '';
    const heuresTxt = (m ? m[2] : r).trim();
    const jours = joursTxt ? joursDe(joursTxt) : [0, 1, 2, 3, 4, 5, 6];
    if (!jours || !jours.length) return null;

    let valeur;
    if (/^(off|closed)$/i.test(heuresTxt)) {
      valeur = 'off';
    } else {
      const creneaux = [];
      for (const c of heuresTxt.split(',')) {
        const cm = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(c);
        if (!cm) return null;
        const d = heure(cm[1]), f = heure(cm[2]);
        if (!d || !f) return null;
        creneaux.push(`${d}–${f}`);
      }
      valeur = creneaux.join(', ');
    }
    for (const j of jours) parJour[j] = valeur;
    lu = true;
  }
  if (!lu) return null;

  const ouverts = parJour.filter(v => v && v !== 'off');
  if (!ouverts.length) return null;
  if (ouverts.length === 7 && ouverts.every(v => v === ouverts[0])) {
    return rendre([{ quand: 'Tous les jours', creneaux: ouverts[0].split(', ') }], [], feries);
  }

  // Les jours qui se suivent et se ressemblent tiennent sur une ligne.
  const blocs = [];
  for (let i = 0; i < 7;) {
    const v = parJour[i];
    let j = i;
    while (j + 1 < 7 && parJour[j + 1] === v) j++;
    if (v && v !== 'off') {
      const quand = j === i ? COURTS[i] : j === i + 1 ? `${COURTS[i]}, ${COURTS[j]}` : `${COURTS[i]}–${COURTS[j]}`;
      blocs.push({ quand: majuscule(quand), creneaux: v.split(', ') });
    }
    i = j + 1;
  }
  const fermes = parJour.map((v, i) => (!v || v === 'off' ? LONGS[i] : null)).filter(Boolean);
  return rendre(blocs, fermes, feries);
}

// Les faits que la carte ouverte affirme d'un lieu, et qui valent d'être dits
// avant d'y aller. Seulement ceux-là : « terrasse » ou « accès fauteuil » se
// lisent sur place, ils ne changent pas la décision d'y aller.
const FAITS = {
  'reservation-requise': 'Réservation obligatoire',
  'reservation-conseillee': 'Réservation conseillée',
  'sans-reservation': 'Sans réservation',
  especes: 'Espèces uniquement',
  emporter: 'À emporter uniquement',
};

/**
 * Les étiquettes de la carte ouverte dont on tire un fait à dire.
 * @param {object} t étiquettes d'un objet OpenStreetMap
 * @returns {string[]} codes de `FAITS`, plus « gratuit »
 */
export function faitsDepuisEtiquettes(t = {}) {
  const v = (k) => String(t[k] || '').trim().toLowerCase();
  const faits = [];
  if (v('reservation') === 'required') faits.push('reservation-requise');
  else if (v('reservation') === 'recommended') faits.push('reservation-conseillee');
  else if (v('reservation') === 'no') faits.push('sans-reservation');
  const cartes = ['payment:credit_cards', 'payment:debit_cards', 'payment:cards'].map(v);
  if (v('payment:cash') === 'only' || (v('payment:cash') === 'yes' && cartes.some(c => c === 'no') && !cartes.some(c => c === 'yes'))) {
    faits.push('especes');
  }
  if (v('takeaway') === 'only') faits.push('emporter');
  if (v('fee') === 'no') faits.push('gratuit');
  return faits;
}

function joursFermes(fermes) {
  // Un ou deux jours de fermeture se retiennent ; au-delà, ce sont les
  // horaires eux-mêmes qui le disent (« Sam, dim 10h–18h »).
  if (!fermes.length || fermes.length > 2) return '';
  return `Fermé le ${fermes.join(' et le ')}`;
}

/**
 * Tout ce que la page montre sous le nom du lieu.
 *
 * @param {object} a la fiche
 * @param {{libelle?: string, prix?: (n: number) => string, quartier?: string|null}} [o]
 *   `libelle` : le nom de la catégorie ; `prix` : la mise en forme d'un montant ;
 *   `quartier` : celui où la Réserve range la fiche.
 */
export function pageDeFiche(a, { libelle = '', prix = (n) => `${n} €`, quartier = null } = {}) {
  const description = String(a.description || '').trim();
  const notes = String(a.notes || '').trim();
  const faits = Array.isArray(a.faits) ? a.faits : [];

  // Les horaires d'un carnet se montrent comme il les écrit : ses nuances
  // (« Dernière entrée 17h », « à vérifier ») ne tiennent pas dans le format
  // machine, qui ne sert qu'à dire « ouvert » ou « fermé ». Sauf quand des
  // horaires sûrs sont venus d'ailleurs — la carte, ou la personne — là où le
  // carnet disait « Midi et soir, jours à vérifier » : vérifiés, ils font foi.
  const duCarnet = String(a.horairesTexte || '').split('\n').map(l => l.trim()).filter(Boolean);
  const lusAilleurs = horairesLisibles(a.openingHours);
  const carnetDepasse = duCarnet.length > 0 && lusAilleurs !== null && a.openingHours !== horairesVersOsm(duCarnet);
  const montrerCarnet = duCarnet.length > 0 && !carnetDepasse;
  const lus = montrerCarnet ? null : lusAilleurs;
  const brut = String(a.openingHours || '').trim();
  // Ce qui ne se lit pas (« Midi et soir », une règle de saison) se montre tel
  // quel, en texte qui revient à la ligne (`texte`).
  const horaires = montrerCarnet ? duCarnet.map(l => ({ quand: '', creneaux: [l], texte: true }))
    : lus ? lus.blocs : brut ? [{ quand: '', creneaux: [brut], texte: true }] : [];

  const montant = parseFloat(a.price) > 0 ? parseFloat(a.price) : 0;
  // Le prix tel que le carnet l'écrit (« ≈ 3 € (6 € coupe-file en ligne) »),
  // tant que le montant n'a pas été changé à la main depuis.
  const prixCarnet = String(a.prixTexte || '').trim();
  const carnetTient = prixCarnet && (montantDe(prixCarnet.split('\n')[0]) ?? 0) === montant;
  const prixDit = carnetTient ? prixCarnet
    : montant > 0 ? prix(montant) : faits.includes('gratuit') ? 'Gratuit' : '';

  const bon = [
    String(a.bonASavoir || '').trim().replace(/\.$/, ''),
    ...faits.map(f => FAITS[f]).filter(Boolean),
    lus ? joursFermes(lus.fermes) : '',
    lus?.feries ? 'Fermé les jours fériés' : '',
  ].filter(Boolean);

  // Deux tuiles côte à côte laissent au prix une dizaine de caractères par
  // ligne sur un téléphone : un prix écrit en phrases (« ≈ 10 - 25 €
  // (estimation) ») ou des horaires longs passent l'une sous l'autre.
  const larges = prixDit.length > 12 || prixDit.includes('\n') || (montrerCarnet && duCarnet.some(l => l.length > 24));

  return {
    // Le quartier tel que la Réserve le range (passé par l'écran), sinon le
    // plus local que la fiche connaisse.
    surtitre: [libelle, quartier ?? quartierDe(a)].filter(Boolean).join(' · '),
    // La note de la personne tient lieu de présentation quand le lieu n'en a
    // pas : elle n'est alors pas redite plus bas.
    presentation: description || notes,
    notes: description ? notes : '',
    horaires,
    prix: prixDit,
    larges,
    bon,
    credit: String(a.photoCredit || '').trim(),
  };
}
