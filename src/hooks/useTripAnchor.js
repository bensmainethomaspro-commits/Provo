import { useState, useEffect } from 'react';

// Point d'ancrage géographique d'un voyage : les coordonnées de sa DESTINATION.
//
// Elles servent à situer toute recherche de lieu — une adresse tapée pendant un
// voyage à Athènes désigne presque toujours une rue d'Athènes.
//
// Auparavant ce point venait de `useWeather`, qui prenait « la première activité
// géolocalisée, sinon la destination ». Un vol « Paris → Athènes » en tête de
// liste suffisait donc à ancrer toutes les recherches sur Paris, à 2 000 km de
// la zone visée — et le défaut empirait à mesure qu'on remplissait le voyage.
// D'où : un point d'ancrage à part, qui ne dépend que de la destination.

const CACHE_KEY = 'provo_dest_coords';

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function writeCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* quota */ }
}

const memory = new Map();

/**
 * Géocode une destination, une seule fois par chaîne de caractères.
 * Le résultat est mémorisé — une destination ne bouge pas, et le géocodeur
 * limite à une requête par seconde.
 */
export async function geocodeDestination(destination) {
  const q = (destination || '').trim();
  if (!q) return null;
  if (memory.has(q)) return memory.get(q);

  const cache = readCache();
  if (cache[q]) { memory.set(q, cache[q]); return cache[q]; }

  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'fr' } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    if (!d?.[0]) return null;
    const coords = { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
    if (!Number.isFinite(coords.lat)) return null;
    memory.set(q, coords);
    writeCache({ ...cache, [q]: coords });
    return coords;
  } catch {
    return null;
  }
}

const cachedFor = (q) => (q ? (memory.get(q) || readCache()[q] || null) : null);

export function useTripAnchor(destination) {
  const q = (destination || '').trim();
  // L'ancrage est mémorisé avec la destination à laquelle il appartient :
  // sinon, le temps que la nouvelle destination soit géocodée, les recherches
  // resteraient biaisées vers l'ancienne.
  const [entry, setEntry] = useState(() => ({ q, coords: cachedFor(q) }));

  useEffect(() => {
    let cancelled = false;
    geocodeDestination(q).then(coords => { if (!cancelled) setEntry({ q, coords }); });
    return () => { cancelled = true; };
  }, [q]);

  return entry.q === q ? entry.coords : cachedFor(q);
}
