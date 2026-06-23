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

function wmoIcon(code) {
  if (WMO[code]) return WMO[code];
  if (code < 50) return '🌤️';
  if (code < 70) return '🌧️';
  return '🌨️';
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
          byDate[date] = {
            max: Math.round(d.daily.temperature_2m_max[i]),
            min: Math.round(d.daily.temperature_2m_min[i]),
            code: d.daily.weathercode[i],
            icon: wmoIcon(d.daily.weathercode[i]),
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
