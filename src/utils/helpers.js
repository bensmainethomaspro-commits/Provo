export const CATEGORIES = [
  { id: 'resto',    emoji: '🍽️', label: 'Resto' },
  { id: 'visite',   emoji: '🏛️', label: 'Visite' },
  { id: 'balade',   emoji: '🥾', label: 'Balade' },
  { id: 'plage',    emoji: '🏖️', label: 'Plage' },
  { id: 'sport',    emoji: '🏋️', label: 'Sport' },
  { id: 'repos',    emoji: '🧘', label: 'Repos' },
  { id: 'trajet',   emoji: '🚗', label: 'Trajet' },
  { id: 'fun',      emoji: '🎉', label: 'Fun' },
];

export const STATUS_CONFIG = {
  todo: { emoji: '⏳', label: 'À faire', cls: 'status--todo' },
  done: { emoji: '✅', label: 'Fait',    cls: 'status--done' },
  nogo: { emoji: '❌', label: 'Nogo',    cls: 'status--nogo' },
};

export const TRIP_EMOJIS = ['✈️','🌍','🗺️','🏕️','🚢','🗽','🏔️','🏖️','🌅','🎡','🏯','🧳','🚂','🚗','⛵'];

export function getCategoryMeta(id) {
  return CATEGORIES.find(c => c.id === id) || { emoji: '📌', label: id };
}

export function totalMinutes(activities) {
  return activities.reduce((sum, a) => sum + (a.durationHours || 0) * 60 + (a.durationMinutes || 0), 0);
}

export function formatDuration(minutes) {
  if (!minutes) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function getDayLabel(index, total) {
  if (total === 1) return 'Jour unique';
  return `Jour ${index + 1}`;
}

export function encodeTrip(trip) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(trip))));
}

export function decodeTrip(encoded) {
  return JSON.parse(decodeURIComponent(escape(atob(encoded))));
}

// ─── Budget ───────────────────────────────────────────────
export function totalBudget(activities) {
  return activities
    .filter(a => a.status !== 'nogo')
    .reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
}

export function formatPrice(amount) {
  if (!amount && amount !== 0) return null;
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
}

export function budgetStats(activities) {
  const active = activities.filter(a => a.status !== 'nogo');
  const total = active.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
  const spent = active.filter(a => a.status === 'done').reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
  return { total, spent, remaining: total - spent };
}

// ─── Time cascade ─────────────────────────────────────────
export function timeToMin(timeStr) {
  const [h, m] = (timeStr || '09:00').split(':').map(Number);
  return h * 60 + m;
}

export function minToTime(minutes) {
  const h = Math.floor(((minutes % 1440) + 1440) % 1440 / 60);
  const m = ((minutes % 1440) + 1440) % 1440 % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getTimeSlots(activities, startTime = '09:00') {
  let current = timeToMin(startTime);
  const slots = {};
  for (const a of activities) {
    if (a.status === 'nogo') { slots[a.id] = null; continue; }
    const dur = (a.durationHours || 0) * 60 + (a.durationMinutes || 0);
    slots[a.id] = { start: minToTime(current), end: minToTime(current + dur) };
    current += dur;
  }
  return slots;
}

// ─── Category colors ──────────────────────────────────────
export const CATEGORY_COLORS = {
  resto:  '#d4704a',
  visite: '#8b6914',
  balade: '#4a7c59',
  plage:  '#2e86c1',
  sport:  '#c0392b',
  repos:  '#6b5b8a',
  trajet: '#7f8c8d',
  fun:    '#d4ac0d',
};

export function deduceTitle(category, address, notes) {
  const cat = CATEGORIES.find(c => c.id === category);
  if (address) {
    const place = address.split(',')[0].trim();
    if (place.length >= 2) return cat ? `${cat.emoji} ${place}` : place;
  }
  if (notes) {
    const first = notes.trim().split(/\n/)[0].split(/\s+/).slice(0, 5).join(' ');
    if (first.length >= 3) return first;
  }
  return cat ? `${cat.emoji} ${cat.label}` : 'Activité';
}

export function parseGoogleMapsUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('google') && !u.hostname.includes('goo.gl')) return null;
    const m = u.pathname.match(/\/maps\/(?:place|search)\/([^/@?&]+)/);
    if (m) return decodeURIComponent(m[1].replace(/\+/g, ' ')).replace(/_/g, ' ');
    const q = u.searchParams.get('q') || u.searchParams.get('daddr');
    if (q) return q;
  } catch {}
  return null;
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/(?:^|\s|-|')\S/g, c => c.toUpperCase());
}

function extractFromHtml(html) {
  // a) <link rel="canonical">
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  if (canonical?.[1]) { const n = parseGoogleMapsUrl(canonical[1]); if (n) return { name: n, url: canonical[1] }; }

  // b) og:url meta
  const ogUrl = html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i);
  if (ogUrl?.[1]) { const n = parseGoogleMapsUrl(ogUrl[1]); if (n) return { name: n, url: ogUrl[1] }; }

  // c) JS redirect: window.location(.replace/.href) = "..." or window.location.replace("...")
  const jsRedir = html.match(/window\.location(?:\.(?:replace|href))?\s*[=(]\s*["']([^"']+)["']/i);
  if (jsRedir?.[1]) {
    const t = jsRedir[1];
    const n = parseGoogleMapsUrl(t); if (n) return { name: n, url: t };
  }

  // d) meta http-equiv refresh
  const refresh = html.match(/http-equiv=["']refresh["'][^>]+content=["'][^;]*;\s*url=([^"'\s>]+)/i)
    || html.match(/content=["'][^;]*;\s*url=([^"'\s>]+)[^>]*http-equiv=["']refresh["']/i);
  if (refresh?.[1]) {
    const t = refresh[1].trim();
    const n = parseGoogleMapsUrl(t); if (n) return { name: n, url: t };
  }

  // e) any google maps URL in the HTML (broadest net)
  const anywhere = html.match(/https?:\/\/(?:www\.|maps\.)?google\.[a-z.]{2,6}\/maps[^"'<>\s\\]*/gi);
  if (anywhere) {
    for (const u of anywhere) {
      const n = parseGoogleMapsUrl(u); if (n) return { name: n, url: u };
    }
  }

  return null;
}

export async function importFromGoogleMaps(url) {
  let resolvedUrl = url;
  let placeName = null;

  if (/google\.com\/maps|goo\.gl|maps\.app/.test(url)) {
    try {
      const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      const html = data.contents || '';
      const finalUrl = data.status?.url || '';
      if (finalUrl && finalUrl !== url) resolvedUrl = finalUrl;

      // Strategy 1: Parse the resolved/original URL directly
      placeName = parseGoogleMapsUrl(resolvedUrl) || parseGoogleMapsUrl(url);

      // Strategy 2: Extract URL from HTML (canonical, og:url, JS redirect, meta refresh, raw search)
      if (!placeName && html) {
        const extracted = extractFromHtml(html);
        if (extracted) { placeName = extracted.name; resolvedUrl = extracted.url; }
      }

      // Strategy 3: DOMParser for og:url / og:title / <title>
      if (!placeName && html) {
        try {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const ogUrlEl = doc.querySelector('meta[property="og:url"]');
          if (ogUrlEl?.content) { const n = parseGoogleMapsUrl(ogUrlEl.content); if (n) { placeName = n; resolvedUrl = ogUrlEl.content; } }
          if (!placeName) {
            const ogTitle = doc.querySelector('meta[property="og:title"]')?.content;
            if (ogTitle) {
              const c = ogTitle.replace(/\s*[-–—]\s*(?:Google Maps|Maps)\s*$/i, '').trim();
              if (c && c.toLowerCase() !== 'google maps') placeName = c;
            }
          }
          if (!placeName) {
            const t = doc.querySelector('title')?.textContent?.trim();
            if (t) {
              const c = t.replace(/\s*[-–—]\s*(?:Google Maps|Maps)\s*$/i, '').trim();
              if (c && c.toLowerCase() !== 'google maps') placeName = c;
            }
          }
        } catch {}
      }

      // Strategy 4: Regex og:title fallback
      if (!placeName && html) {
        const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
        if (m) {
          const c = m[1].replace(/\s*[-–—]\s*(?:Google Maps|Maps)\s*$/i, '').trim();
          if (c && c.toLowerCase() !== 'google maps') placeName = c;
        }
      }
    } catch {}
  }

  if (!placeName) placeName = parseGoogleMapsUrl(url);
  if (!placeName) return null;

  const placeData = await fetchPlaceData(placeName).catch(() => null);
  const cleanTitle = toTitleCase(placeName.replace(/\+/g, ' '));

  if (placeData) return { ...placeData, title: placeData.title || cleanTitle, link: url };
  return { title: cleanTitle, link: url };
}

export async function resolveShortUrl(url) {
  if (!/goo\.gl|maps\.app/.test(url)) return url;
  try {
    const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    return data.status?.url || url;
  } catch { return url; }
}

export async function fetchPlaceData(query) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&extratags=1&limit=1`
  );
  const data = await res.json();
  if (!data?.length) return null;
  const p = data[0];
  const a = p.address || {};
  const ex = p.extratags || {};

  // Richer address: road + number, city, country — fallback to display_name excerpt
  const road = [a.road || a.pedestrian || a.footway, a.house_number].filter(Boolean).join(' ');
  const address = [road, a.city || a.town || a.village || a.municipality, a.country]
    .filter(Boolean).join(', ')
    || p.display_name.split(',').slice(0, 3).join(',').trim();

  // Category from ALL available tags (class + type + extratags)
  const typeText = [p.type, p.class, ex.amenity, ex.tourism, ex.leisure, ex.natural, ex.shop, ex.sport]
    .filter(Boolean).join(' ').toLowerCase();
  const catRules = [
    [/restaurant|cafe|coffee|brasserie|bar|pub|fast_food|food_court|bistro|snack|tabac_presse/, 'resto'],
    [/beach|plage|coast|swimming_area|baignade/, 'plage'],
    [/sport|fitness|gym|swimming_pool|stadium|climbing|tennis|golf|ski|surf/, 'sport'],
    [/hotel|hostel|motel|lodge|inn|guesthouse|resort|chalet|accommodation/, 'repos'],
    [/airport|train_station|bus_station|ferry_terminal|metro|subway|tram/, 'trajet'],
    [/park|forest|trail|hiking|viewpoint|peak|waterfall|garden|nature_reserve|bay|lake|river|wood/, 'balade'],
    [/nightclub|casino|cinema|theatre|amusement|theme_park|arcade|entertainment|concert/, 'fun'],
  ];
  let category = 'visite';
  for (const [re, cat] of catRules) {
    if (re.test(typeText)) { category = cat; break; }
  }

  // Wikipedia thumbnail (preserve the language code)
  let photoUrl = null;
  const wikiRaw = ex.wikipedia || '';
  const wikiLangMatch = wikiRaw.match(/^([a-z]{2}):/);
  const wikiLang = wikiLangMatch?.[1] || 'en';
  const wikiKey = wikiLangMatch ? wikiRaw.slice(wikiLangMatch[0].length) : wikiRaw;
  if (wikiKey) {
    try {
      const wRes = await fetch(
        `https://${wikiLang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiKey)}`
      );
      if (wRes.ok) {
        const w = await wRes.json();
        photoUrl = w.thumbnail?.source?.replace(/\/\d+px-/, '/600px-') || null;
      }
    } catch {}
  }

  return {
    title: (p.name || p.display_name.split(',')[0]).trim(),
    address,
    category,
    photoUrl,
    openingHours: ex.opening_hours || '',
    lat: parseFloat(p.lat),
    lon: parseFloat(p.lon),
  };
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── Dynamic sky ──────────────────────────────────────────
export function getSkyGradient() {
  const h = new Date().getHours();
  if (h >= 6  && h < 11) return 'linear-gradient(160deg, #7EC8E3 0%, #FFD09B 50%, #FFB4A2 100%)';
  if (h >= 11 && h < 18) return 'linear-gradient(160deg, #FF6B35 0%, #FF8C42 30%, #FFB347 60%, #FFCF56 100%)';
  if (h >= 18 && h < 22) return 'linear-gradient(160deg, #C94B4B 0%, #FF6B35 30%, #FFA07A 60%, #845EC2 100%)';
  return 'linear-gradient(160deg, #0a0a2e 0%, #162447 40%, #1f4068 70%, #1b262c 100%)';
}

// ─── Logic alerts ─────────────────────────────────────────
export function getLogicAlerts(activities) {
  const alerts = [];
  const active = activities.filter(a => a.status !== 'nogo');
  const total = totalMinutes(active);

  if (total > 8 * 60) {
    alerts.push({ type: 'overload', icon: '⚠️', message: `Journée surchargée ! (${formatDuration(total)} planifiées)` });
  }

  const hasMeal = active.some(a => a.category === 'resto');
  if (!hasMeal && total >= 180) {
    alerts.push({ type: 'meal', icon: '🍽️', message: 'Aucun repas prévu pour cette longue journée.' });
  }

  const sportMin = active.filter(a => ['sport','balade'].includes(a.category))
    .reduce((s, a) => s + (a.durationHours||0)*60 + (a.durationMinutes||0), 0);
  if (sportMin > 3 * 60) {
    alerts.push({ type: 'effort', icon: '🧘', message: `Grosse journée sportive (${formatDuration(sportMin)}) — pensez à du repos !` });
  }

  return alerts;
}
