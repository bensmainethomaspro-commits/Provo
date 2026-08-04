/**
 * Ce qu'il faut savoir d'une idée en réserve pour la piocher vite.
 *
 * Sur place, la question n'est pas « qu'ai-je noté ? » mais « qu'est-ce qui
 * est ouvert, maintenant, près de moi ? ». On a les horaires et la position :
 * autant répondre directement plutôt que de laisser trier à la main.
 */

const JOURS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function minutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}

/**
 * Ce lieu est-il ouvert à cet instant ?
 *
 * Lit le format OpenStreetMap, mais seulement ce qu'il sait lire avec
 * certitude. Tout le reste renvoie `null` — « on ne sait pas ». La distinction
 * est capitale : annoncer « fermé » à tort ferait renoncer à un lieu ouvert,
 * ce qui est bien pire que de ne rien dire.
 *
 * @returns {boolean|null} true ouvert, false fermé, null indéterminé
 */
export function ouvertMaintenant(horaires, maintenant = new Date()) {
  const src = (horaires || '').trim();
  if (!src) return null;
  if (/^24\/7$/i.test(src)) return true;

  const jour = JOURS[maintenant.getDay()];
  const t = maintenant.getHours() * 60 + maintenant.getMinutes();
  let vu = false;

  for (const regle of src.split(';')) {
    const r = regle.trim();
    if (!r) continue;
    // « PH » (jours fériés) demande un calendrier qu'on n'a pas.
    if (/^PH/i.test(r)) continue;

    const m = /^([A-Za-z,\-\s]+?)\s+(.+)$/.exec(r);
    if (!m) continue;
    const [, joursTxt, heuresTxt] = m;

    // Quels jours cette règle couvre-t-elle ?
    const couverts = new Set();
    for (const bloc of joursTxt.split(',')) {
      const b = bloc.trim();
      const plage = /^([A-Za-z]{2})\s*-\s*([A-Za-z]{2})$/.exec(b);
      if (plage) {
        const d = JOURS.findIndex(j => j.toLowerCase() === plage[1].toLowerCase());
        const f = JOURS.findIndex(j => j.toLowerCase() === plage[2].toLowerCase());
        if (d < 0 || f < 0) return null;
        for (let k = 0; k < 7; k++) {
          const idx = (d + k) % 7;
          couverts.add(JOURS[idx]);
          if (idx === f) break;
        }
      } else {
        const idx = JOURS.findIndex(j => j.toLowerCase() === b.toLowerCase());
        if (idx < 0) { if (!/^PH$/i.test(b)) return null; continue; }
        couverts.add(JOURS[idx]);
      }
    }
    if (!couverts.has(jour)) continue;
    vu = true;

    if (/^off$/i.test(heuresTxt.trim())) return false;

    for (const creneau of heuresTxt.split(',')) {
      const c = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(creneau);
      if (!c) return null;
      const d = minutes(c[1]), f = minutes(c[2]);
      if (d == null || f == null) return null;
      // Un créneau qui passe minuit (22:00-02:00) couvre deux journées.
      if (f <= d ? (t >= d || t < f) : (t >= d && t < f)) return true;
    }
  }

  // Une règle couvrait aujourd'hui sans qu'aucun créneau ne corresponde :
  // c'est bien fermé. Aucune règle ne couvrait aujourd'hui : on ne sait pas.
  return vu ? false : null;
}

/**
 * Cette idée est-elle déjà casée dans une journée ?
 * On compare sur le titre : une idée assignée est copiée, pas référencée.
 */
export function dejaPlanifiee(activite, days) {
  const t = (activite.title || '').trim().toLowerCase();
  if (!t) return false;
  return (days || []).some(d =>
    (d.activities || []).some(a => (a.title || '').trim().toLowerCase() === t)
  );
}

/**
 * Ce qui manque pour ne pas avoir à chercher sur place.
 * Volontairement court : trois champs, pas dix. Un signal qui parle tout le
 * temps ne parle plus.
 */
export function manques(activite) {
  const m = [];
  if (!activite.openingHours) m.push('horaires');
  const sansPrix = activite.price === '' || activite.price == null || parseFloat(activite.price) === 0;
  if (sansPrix) m.push('prix');
  if (!activite.address) m.push('adresse');
  return m;
}
