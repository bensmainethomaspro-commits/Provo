// Complète automatiquement une fiche d'activité avec les informations
// publiques du lieu (adresse, coordonnées, horaires, prix, site web).
//
// Principe produit : l'utilisateur ne doit pas avoir à saisir ces informations
// pour en profiter — on les cherche en ligne dès qu'une activité est ajoutée.
//
// On interroge Nominatim (OpenStreetMap) directement depuis le navigateur,
// comme le fait déjà l'app pour Overpass, Wikipédia et la météo. Pas de clé
// d'API, pas de fonction serveur à déployer.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const cache = new Map();

// Nominatim demande un usage raisonnable : une requête à la fois, en série.
let queue = Promise.resolve();

function parsePrice(extratags = {}) {
  // OSM stocke le tarif dans `charge` ou `fee` ("5 EUR", "free", "yes"…)
  const raw = extratags.charge || extratags['fee:amount'] || '';
  const m = String(raw).match(/\d+([.,]\d+)?/);
  if (m) return parseFloat(m[0].replace(',', '.'));
  if (/^(no|free)$/i.test(extratags.fee || '')) return 0;
  return null;
}

function buildAddress(a = {}) {
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.municipality;
  return [street || a.suburb || a.neighbourhood, city, a.country]
    .filter(Boolean).join(', ');
}

/**
 * Cherche les informations manquantes d'un lieu.
 * @param {string} title   nom de l'activité (ex. « Rocher de la Vierge »)
 * @param {string} near    destination du voyage, pour lever l'ambiguïté
 * @returns {Promise<object|null>} champs trouvés, ou null si rien de fiable
 */
export async function lookupPlace(title, near) {
  const name = (title || '').trim();
  if (name.length < 3) return null;

  const query = near ? `${name}, ${near}` : name;
  const key = query.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const run = async () => {
    try {
      const url = `${NOMINATIM}?q=${encodeURIComponent(query)}`
        + '&format=json&addressdetails=1&extratags=1&limit=1';
      const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
      if (!res.ok) return null;
      const data = await res.json();
      const p = Array.isArray(data) ? data[0] : null;
      if (!p) return null;

      const ex = p.extratags || {};
      const price = parsePrice(ex);
      const found = {
        lat: parseFloat(p.lat),
        lon: parseFloat(p.lon),
        address: buildAddress(p.address),
        openingHours: ex.opening_hours || '',
        ...(ex.website || ex['contact:website'] ? { link: ex.website || ex['contact:website'] } : {}),
        ...(price != null ? { price } : {}),
      };
      cache.set(key, found);
      return found;
    } catch {
      return null; // hors ligne ou service indisponible : on ne bloque rien
    }
  };

  // Sérialisé pour rester poli avec le service public Nominatim.
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

/**
 * Ne renvoie que les champs réellement manquants de l'activité, pour ne jamais
 * écraser ce que l'utilisateur a saisi lui-même.
 */
export function missingFieldsFrom(activity, found) {
  if (!found) return null;
  const patch = {};
  if (!activity.address && found.address) patch.address = found.address;
  if (!activity.openingHours && found.openingHours) patch.openingHours = found.openingHours;
  if (!activity.link && found.link) patch.link = found.link;
  if (!activity.lat && found.lat) { patch.lat = found.lat; patch.lon = found.lon; }
  const noPrice = activity.price === '' || activity.price == null || parseFloat(activity.price) === 0;
  if (noPrice && found.price != null && found.price > 0) patch.price = found.price;
  return Object.keys(patch).length ? patch : null;
}
