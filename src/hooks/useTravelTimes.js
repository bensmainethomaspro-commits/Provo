import { useState, useEffect } from 'react';

const cache = {};

export function useTravelTimes(activities) {
  const [times, setTimes] = useState({});

  const geoIds = activities.filter(a => a.lat && a.lon && a.status !== 'nogo').map(a => a.id).join(',');

  useEffect(() => {
    const geoActs = activities.filter(a => a.lat && a.lon && a.status !== 'nogo');
    if (geoActs.length < 2) { setTimes({}); return; }
    let cancelled = false;

    async function fetchAll() {
      const results = {};
      for (let i = 0; i < geoActs.length - 1; i++) {
        const a = geoActs[i];
        const b = geoActs[i + 1];
        const key = `${a.id}_${b.id}`;
        if (cache[key]) { results[key] = cache[key]; continue; }
        try {
          const r = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`
          );
          const d = await r.json();
          if (d.routes?.[0]) {
            const res = {
              minutes: Math.round(d.routes[0].duration / 60),
              km: (d.routes[0].distance / 1000).toFixed(1),
            };
            cache[key] = res;
            results[key] = res;
          }
        } catch {}
        if (cancelled) return;
      }
      if (!cancelled) setTimes(results);
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [geoIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const getTime = (aId, bId) => times[`${aId}_${bId}`] || null;
  return { times, getTime };
}
