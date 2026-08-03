import { fetchPlaceData } from './helpers';

/**
 * Localise l'adresse d'hébergement, une fois, à la saisie.
 *
 * Jusqu'ici la carte la re-géocodait à chaque ouverture. Trois défauts :
 * il fallait du réseau pour voir son propre hôtel, chaque ouverture
 * redemandait la même chose à un service limité à une requête par seconde,
 * et quand ça ratait — 429, coupure, adresse introuvable — le `.catch()` de
 * la carte avalait l'échec. L'épingle 🏠 manquait sans que rien ne le dise.
 *
 * On résout donc au moment où l'utilisateur saisit, on stocke le résultat sur
 * le voyage, et on rend l'échec visible.
 */

/**
 * Un nom d'établissement en tête d'adresse — « Hotel Terminus,
 * Fillgradergasse 4 Wien » — fait souvent échouer l'analyse structurée du
 * géocodeur. On essaie donc plusieurs formulations, de la plus riche à la plus
 * dépouillée, et on garde la première qui répond.
 */
export function variantesAdresse(adresse, destination = '') {
  const a = (adresse || '').trim();
  if (!a) return [];
  const out = [a];

  const virgule = a.indexOf(',');
  if (virgule > 0) {
    // Sans le nom de l'établissement : il ne reste que la rue et la ville.
    const sansNom = a.slice(virgule + 1).trim();
    if (sansNom.length > 4) out.push(sansNom);
  }

  const ville = (destination || '').trim();
  // La ville lève l'ambiguïté quand l'adresse ne la porte pas elle-même.
  if (ville && !new RegExp(ville.split(/[\s,]+/)[0], 'i').test(a)) {
    out.push(`${a}, ${ville}`);
    if (virgule > 0) out.push(`${a.slice(virgule + 1).trim()}, ${ville}`);
  }

  return [...new Set(out)].slice(0, 4);
}

/**
 * @returns {Promise<{lat, lon, address}|null>} null si vraiment introuvable
 */
export async function localiserHebergement(adresse, { destination = '', lat = null, lon = null } = {}) {
  for (const essai of variantesAdresse(adresse, destination)) {
    let p;
    try {
      p = await fetchPlaceData(essai, { lat, lon });
    } catch {
      // Une réponse illisible ne condamne pas les variantes suivantes : on
      // passe à la suivante plutôt que d'abandonner sur le premier accroc.
      p = null;
    }
    if (p && Number.isFinite(p.lat)) {
      return { lat: p.lat, lon: p.lon, address: p.address || essai };
    }
    // Nominatim tolère une requête par seconde. Enchaîner les variantes sans
    // pause les ferait toutes retomber sur un 429.
    await new Promise(r => setTimeout(r, 1100));
  }
  return null;
}
