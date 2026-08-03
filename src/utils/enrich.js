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
//
// « En série » ne suffit pas : enchaînées sans pause, vingt requêtes partent en
// quelques secondes et le service répond alors des vides. On l'a mesuré — un
// contrôle qui semblait rater huit lieux sur neuf n'était que rate-limité. La
// file n'avance donc qu'après un délai, ce qui garantit l'intervalle quelle que
// soit la vitesse du réseau.
const PAUSE_MS = 1100;
const pause = (ms) => new Promise(r => setTimeout(r, ms));
let queue = Promise.resolve();

function enfile(run) {
  const result = queue.then(run, run);
  queue = result.then(() => pause(PAUSE_MS), () => pause(PAUSE_MS));
  return result;
}

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

const GENERIC_CLASSES = ['place', 'highway', 'boundary', 'building', 'landuse'];

export function distKm(aLat, aLon, bLat, bLon) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Nominatim : très bon sur les lieux « nommés » (monuments, plages, parcs) ──
// On demande cinq résultats et on garde le mieux renseigné, le plus proche du
// voyage. Avec `limit=1`, le géocodeur imposait son premier choix — souvent une
// rue ou un immeuble plutôt que l'établissement cherché.
async function searchNominatim(query, lat = null, lon = null) {
  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(query)}`
      + '&format=json&addressdetails=1&extratags=1&limit=5';
    const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;

    let p = null, best = -Infinity;
    for (const c of data) {
      const cLat = parseFloat(c.lat), cLon = parseFloat(c.lon);
      if (!Number.isFinite(cLat)) continue;
      const ex = c.extratags || {};
      let s = 0;
      if (c.name) s += 3;
      if (!GENERIC_CLASSES.includes(c.class)) s += 4;
      if (ex.opening_hours) s += 2;
      if (ex.website || ex['contact:website']) s += 1;
      if (c.address?.house_number) s += 1;
      if (lat != null && lon != null) {
        const d = distKm(lat, lon, cLat, cLon);
        // Un homonyme à l'autre bout du monde n'est jamais le bon.
        if (d > 500) continue;
        s += d < 1 ? 5 : d < 10 ? 3 : d < 75 ? 1 : 0;
      }
      if (s > best) { best = s; p = c; }
    }
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

// Catégories Provo déduites des étiquettes OSM d'un commerce.
const POI_CAT = [
  [/restaurant|cafe|coffee|bar|pub|fast_food|bistro|bakery|ice_cream|food/, 'resto'],
  [/hotel|hostel|guest_house|apartment|motel|spa|chalet/, 'repos'],
  [/museum|gallery|artwork|monument|memorial|castle|attraction|viewpoint/, 'visite'],
  [/cinema|theatre|nightclub|casino|arcade|bowling|zoo|aquarium/, 'fun'],
  [/gym|fitness|sports_centre|swimming|climbing|surf/, 'sport'],
  [/park|garden|beach|nature_reserve/, 'balade'],
];

/**
 * Que trouve-t-on exactement à ces coordonnées ?
 *
 * Chercher « 2 Rue du Helder » par son nom ne donne rien : une adresse n'est
 * pas un commerce. Mais il y a souvent un établissement à ce point précis —
 * c'est lui qui porte les horaires, le site et le téléphone.
 *
 * @returns {Promise<object|null>} le lieu nommé le plus proche, ou null
 */
export async function poiAtCoords(lat, lon, radius = 60) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const key = `poi|${lat.toFixed(5)}|${lon.toFixed(5)}|${radius}`;
  if (cache.has(key)) return cache.get(key);

  const q = `[out:json][timeout:20];nwr["name"]["amenity"~"."](around:${radius},${lat},${lon});`
    + `nwr["name"]["tourism"~"."](around:${radius},${lat},${lon});`
    + `nwr["name"]["shop"~"."](around:${radius},${lat},${lon});out tags center 8;`;

  const run = async () => {
    try {
      const res = await fetch(`${OVERPASS}?data=${encodeURIComponent(q)}`);
      if (!res.ok) return null;
      const data = await res.json();
      const els = (data?.elements || []).filter(e => e.tags?.name);
      if (!els.length) return null;

      // Le plus proche du point demandé.
      const dist = (e) => {
        const y = e.lat ?? e.center?.lat, x = e.lon ?? e.center?.lon;
        if (y == null || x == null) return Infinity;
        return (y - lat) ** 2 + (x - lon) ** 2;
      };
      els.sort((a, b) => dist(a) - dist(b));
      const t = els[0].tags;
      const typeText = [t.amenity, t.tourism, t.shop, t.leisure].filter(Boolean).join(' ').toLowerCase();
      let category = null;
      for (const [re, c] of POI_CAT) if (re.test(typeText)) { category = c; break; }

      const found = {
        title: t.name,
        ...(category ? { category } : {}),
        openingHours: t.opening_hours || '',
        ...(t.website || t['contact:website'] ? { link: t.website || t['contact:website'] } : {}),
        ...(t.phone || t['contact:phone'] ? { phone: t.phone || t['contact:phone'] } : {}),
        lat: els[0].lat ?? els[0].center?.lat,
        lon: els[0].lon ?? els[0].center?.lon,
      };
      cache.set(key, found);
      return found;
    } catch {
      return null;
    }
  };

  return enfile(run);
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
    let found = await searchNominatim(query, coords.lat, coords.lon);
    // Le nom seul, sans la ville, ramène des homonymes à l'autre bout du monde
    // (« Da Enzo al 29 » → une rue au Brésil). On ne l'essaie qu'en dernier, et
    // seulement si le voyage donne un point d'ancrage pour vérifier.
    if (!found && near && coords.lat != null) {
      found = await searchNominatim(name, coords.lat, coords.lon);
    }
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
  return enfile(run);
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
