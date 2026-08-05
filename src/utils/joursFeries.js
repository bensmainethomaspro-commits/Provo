/**
 * Les jours fériés du pays visité.
 *
 * Le lecteur d'horaires OpenStreetMap saute explicitement les règles « PH »
 * (public holidays) : il n'a pas de calendrier. Résultat, un musée fermé le
 * 15 août passait pour ouvert — exactement le genre de porte close devant
 * laquelle le produit existe pour ne pas se retrouver.
 *
 * Source : Nager.Date — sans clé, sans limite de débit, 100+ pays.
 *
 * Tout est mis en cache localement : un jour férié ne change pas, et l'app
 * doit pouvoir le dire hors ligne, sur place, sans réseau.
 */

const CLE = 'provo_feries';
const BASE = 'https://date.nager.at/api/v3/PublicHolidays';

const lireCache = () => {
  try { return JSON.parse(localStorage.getItem(CLE) || '{}'); } catch { return {}; }
};
const ecrireCache = (c) => {
  try { localStorage.setItem(CLE, JSON.stringify(c)); } catch { /* quota */ }
};

// Une requête par pays et par année, jamais deux fois — y compris entre deux
// composants qui demandent en même temps.
const enCours = new Map();

/**
 * Les jours fériés d'un pays pour une année, sous la forme
 * `{ '2026-08-15': 'Mariä Himmelfahrt' }`.
 *
 * Rend `{}` plutôt que d'échouer : ne pas connaître le calendrier doit
 * simplement faire taire le signal, jamais casser un écran.
 */
export async function chargerFeries(pays, annee) {
  const code = (pays || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || !Number.isInteger(annee)) return {};
  const cle = `${code}-${annee}`;

  const cache = lireCache();
  if (cache[cle]) return cache[cle];
  if (enCours.has(cle)) return enCours.get(cle);

  const p = (async () => {
    try {
      const r = await fetch(`${BASE}/${annee}/${code}`);
      if (!r.ok) return {};
      const d = await r.json();
      if (!Array.isArray(d)) return {};
      const out = {};
      for (const j of d) {
        // `global: false` désigne une fête régionale : elle ne ferme pas le
        // pays, l'annoncer partout serait faux.
        if (j?.date && j.global !== false) out[j.date] = j.localName || j.name || 'jour férié';
      }
      ecrireCache({ ...lireCache(), [cle]: out });
      return out;
    } catch {
      // Hors ligne : on ne met rien en cache, on redemandera.
      return {};
    } finally {
      enCours.delete(cle);
    }
  })();

  enCours.set(cle, p);
  return p;
}

/** Ce qu'on sait déjà, sans réseau. C'est ce qui sert sur place. */
export function feriesEnCache(pays, annees) {
  const code = (pays || '').toUpperCase();
  const cache = lireCache();
  const out = {};
  for (const a of annees) Object.assign(out, cache[`${code}-${a}`] || {});
  return out;
}

/** Les années couvertes par un voyage — rarement deux, jamais zéro. */
export function anneesDuVoyage(trip) {
  const dates = (trip?.days || []).map(d => d.date).filter(Boolean);
  const an = (s) => Number(String(s).slice(0, 4));
  const set = new Set(dates.map(an).filter(Number.isInteger));
  if (!set.size) set.add(new Date().getFullYear());
  return [...set];
}

/**
 * Précharge ce qu'il faut pour ce voyage, tant qu'on a du réseau.
 * @returns {Promise<Record<string,string>>}
 */
export async function preparerFeries(pays, trip) {
  const annees = anneesDuVoyage(trip);
  const parts = await Promise.all(annees.map(a => chargerFeries(pays, a)));
  return Object.assign({}, ...parts);
}
