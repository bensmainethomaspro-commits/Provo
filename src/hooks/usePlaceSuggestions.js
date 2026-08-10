import { useState, useEffect } from 'react';

const cache = {};

function inferCategory(tags) {
  const t = [tags.tourism, tags.amenity, tags.leisure].filter(Boolean).join(' ').toLowerCase();
  if (/restaurant|cafe|coffee|bar|pub|fast_food|bistro|brasserie/.test(t)) return 'resto';
  if (/beach|plage|water_park/.test(t)) return 'plage';
  if (/nightclub|theatre|cinema|entertainment|casino/.test(t)) return 'fun';
  if (/hotel|hostel|motel|guest_house|resort/.test(t)) return 'repos';
  if (/park|garden|nature_reserve|viewpoint/.test(t)) return 'balade';
  return 'visite';
}

export function usePlaceSuggestions(lat, lon, enabled = true) {
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    if (!lat || !lon || !enabled) return;
    const key = `${parseFloat(lat).toFixed(2)}_${parseFloat(lon).toFixed(2)}`;
    if (cache[key]) { setSuggestions(cache[key]); return; }

    const q = `[out:json][timeout:10];(node(around:3000,${lat},${lon})[tourism~"^(attraction|museum|viewpoint|gallery|artwork|theme_park|zoo|aquarium)$"];node(around:3000,${lat},${lon})[amenity~"^(restaurant|cafe|bar|theatre|cinema|nightclub)$"];);out 20;`;

    fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(data => {
        const places = (data.elements || [])
          .filter(e => e.tags?.name)
          .map(e => ({
            id: String(e.id),
            title: e.tags.name,
            lat: e.lat,
            lon: e.lon,
            address: [e.tags['addr:housenumber'], e.tags['addr:street']].filter(Boolean).join(' '),
            category: inferCategory(e.tags),
          }))
          .slice(0, 15);
        cache[key] = places;
        setSuggestions(places);
      })
      .catch(() => {});
  }, [lat, lon, enabled]);

  return { suggestions };
}
