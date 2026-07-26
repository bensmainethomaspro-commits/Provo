import { useState, useEffect } from 'react';

const WMO = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  61: '🌦️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '❄️', 77: '❄️',
  80: '🌦️', 81: '🌧️', 82: '⛈️',
  85: '🌨️', 86: '❄️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

const WMO_LABEL = {
  0: 'Ciel dégagé', 1: 'Peu nuageux', 2: 'Partiellement nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine légère', 53: 'Bruine modérée', 55: 'Bruine dense',
  61: 'Pluie légère', 63: 'Pluie modérée', 65: 'Forte pluie',
  71: 'Neige légère', 73: 'Neige modérée', 75: 'Forte neige',
  80: 'Averses légères', 81: 'Averses', 82: 'Fortes averses',
  85: 'Averses neigeuses', 86: 'Fortes averses neigeuses',
  95: 'Orage', 96: 'Orage + grêle', 99: 'Orage violent',
};

function wmoIcon(code) {
  if (WMO[code]) return WMO[code];
  if (code < 50) return '🌤️';
  if (code < 70) return '🌧️';
  return '🌨️';
}

function wmoLabel(code) {
  return WMO_LABEL[code] || 'Variable';
}

export function useWeather(trip) {
  const [weather, setWeather] = useState(null);

  useEffect(() => {
    if (!trip) return;
    let cancelled = false;

    async function fetch_() {
      // 1. Find coordinates: prefer activity lat/lon, then geocode destination
      let lat = null, lon = null;
      const allActs = [...trip.days.flatMap(d => d.activities), ...trip.reserve];
      const geoAct = allActs.find(a => a.lat && a.lon);
      if (geoAct) { lat = geoAct.lat; lon = geoAct.lon; }

      if ((!lat || !lon) && trip.destination?.trim()) {
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trip.destination)}&format=json&limit=1`
          );
          const d = await r.json();
          if (d?.[0]) { lat = parseFloat(d[0].lat); lon = parseFloat(d[0].lon); }
        } catch {}
      }

      if (!lat || !lon || cancelled) return;

      // Les coordonnées du voyage servent ailleurs que pour la météo : biais de
      // la recherche d'adresse, suggestions « à proximité », distances. On les
      // publie dès qu'on les a, sans attendre le bulletin — sinon une météo
      // indisponible prive l'app de tout repère géographique.
      setWeather(w => ({ ...(w || {}), lat, lon }));

      // 2. Pick archive vs forecast
      const tripEnd = new Date(trip.endDate + 'T00:00:00');
      const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const base = tripEnd < twoWeeksAgo
        ? 'https://archive-api.open-meteo.com/v1/archive'
        : 'https://api.open-meteo.com/v1/forecast';

      try {
        const params = new URLSearchParams({
          latitude: lat, longitude: lon,
          daily: 'temperature_2m_max,temperature_2m_min,weathercode',
          timezone: 'auto',
          start_date: trip.startDate, end_date: trip.endDate,
        });
        const r = await fetch(`${base}?${params}`);
        if (!r.ok || cancelled) return;
        const d = await r.json();
        if (!d.daily?.time) return;

        const byDate = {};
        d.daily.time.forEach((date, i) => {
          const code = d.daily.weathercode[i];
          byDate[date] = {
            max: Math.round(d.daily.temperature_2m_max[i]),
            min: Math.round(d.daily.temperature_2m_min[i]),
            code,
            icon: wmoIcon(code),
            description: wmoLabel(code),
          };
        });
        if (!cancelled) setWeather({ byDate, lat, lon });
      } catch {}
    }

    fetch_();
    return () => { cancelled = true; };
  }, [trip?.id, trip?.destination]); // eslint-disable-line react-hooks/exhaustive-deps

  return weather;
}
