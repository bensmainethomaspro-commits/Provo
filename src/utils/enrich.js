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
const OVERPASS = 'https://overpass-api.de/api/interpreter';
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

// ── Nominatim : très bon sur les lieux « nommés » (monuments, plages, parcs) ──
async function searchNominatim(query) {
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
    return {
      lat: parseFloat(p.lat),
      lon: parseFloat(p.lon),
      address: buildAddress(p.address),
      openingHours: ex.opening_hours || '',
      ...(ex.website || ex['contact:website'] ? { link: ex.website || ex['contact:website'] } : {}),
      ...(price != null ? { price } : {}),
    };
  } catch {
    return null;
  }
}

// ── Overpass : bien meilleur sur les commerces (restaurants, bars, cafés), que
// la recherche par nom de Nominatim rate souvent. On cherche l'objet OSM dont
// le nom correspond, autour de la destination.
async function searchOverpass(name, lat, lon) {
  if (!lat || !lon) return null;
  const safe = name.replace(/["\\]/g, ' ').replace(/[.*+?^${}()|[\]]/g, '.');
  const q = `[out:json][timeout:20];nwr["name"~"${safe}",i](around:25000,${lat},${lon});out tags center 1;`;
  try {
    const res = await fetch(`${OVERPASS}?data=${encodeURIComponent(q)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const el = data?.elements?.[0];
    if (!el) return null;
    const t = el.tags || {};
    const price = parsePrice(t);
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    const address = [street, t['addr:city'], t['addr:country']].filter(Boolean).join(', ');
    return {
      lat: el.lat ?? el.center?.lat,
      lon: el.lon ?? el.center?.lon,
      address,
      openingHours: t.opening_hours || '',
      ...(t.website || t['contact:website'] ? { link: t.website || t['contact:website'] } : {}),
      ...(price != null ? { price } : {}),
    };
  } catch {
    return null;
  }
}

// Garde le champ le plus informatif de chaque source.
function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    lat: a.lat ?? b.lat,
    lon: a.lon ?? b.lon,
    address: a.address || b.address,
    openingHours: a.openingHours || b.openingHours,
    ...((a.link || b.link) ? { link: a.link || b.link } : {}),
    ...((a.price ?? b.price) != null ? { price: a.price ?? b.price } : {}),
  };
}

/**
 * Cherche les informations manquantes d'un lieu.
 * @param {string} title  nom de l'activité (ex. « Rocher de la Vierge »)
 * @param {string} near   destination du voyage, pour lever l'ambiguïté
 * @param {object} coords {lat, lon} du voyage, pour la recherche de proximité
 * @returns {Promise<object|null>} champs trouvés, ou null si rien de fiable
 */
export async function lookupPlace(title, near, coords = {}) {
  const name = (title || '').trim();
  if (name.length < 3) return null;

  const query = near ? `${name}, ${near}` : name;
  const key = `${query}|${coords.lat ?? ''}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const run = async () => {
    let found = await searchNominatim(query);
    // Complète (ou remplace) via Overpass si des informations clés manquent —
    // typiquement le cas des restaurants et cafés.
    if (!found || !found.openingHours || !found.address) {
      const viaOsm = await searchOverpass(name, coords.lat, coords.lon);
      found = merge(found, viaOsm);
    }
    if (found) cache.set(key, found);
    return found;
  };

  // Sérialisé pour rester poli avec ces services publics et gratuits.
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
